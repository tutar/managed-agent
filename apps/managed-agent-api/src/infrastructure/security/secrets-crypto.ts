import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

const decodeKeyMaterial = (value: string) => {
	const trimmedValue = value.trim();

	if (trimmedValue.length === 0) {
		throw new Error("MANAGED_AGENT_SECRETS_KEY must not be empty");
	}

	const base64Buffer = Buffer.from(trimmedValue, "base64");
	if (base64Buffer.length === 32 && base64Buffer.toString("base64") === trimmedValue) {
		return base64Buffer;
	}

	const hexBuffer = Buffer.from(trimmedValue, "hex");
	if (hexBuffer.length === 32 && hexBuffer.toString("hex") === trimmedValue.toLowerCase()) {
		return hexBuffer;
	}

	return createHash("sha256").update(trimmedValue, "utf8").digest();
};

/**
 * Encrypt and decrypt provider secrets before they are persisted to PostgreSQL.
 *
 * The service uses one application-level master key so provider credentials do
 * not sit in plaintext at rest even though the rest of the metadata is stored
 * in regular relational columns.
 */
export const createSecretsCrypto = ({
	masterKey = process.env.MANAGED_AGENT_SECRETS_KEY,
}: {
	masterKey?: string;
} = {}) => {
	if (!masterKey) {
		throw new Error("MANAGED_AGENT_SECRETS_KEY is required for provider secret encryption.");
	}

	const key = decodeKeyMaterial(masterKey);

	return {
		encrypt(plaintext: string) {
			const iv = randomBytes(IV_LENGTH);
			const cipher = createCipheriv(ALGORITHM, key, iv);
			const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
			const authTag = cipher.getAuthTag();

			return Buffer.concat([iv, authTag, encrypted]).toString("base64");
		},
		decrypt(ciphertext: string) {
			const payload = Buffer.from(ciphertext, "base64");
			const iv = payload.subarray(0, IV_LENGTH);
			const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + 16);
			const encrypted = payload.subarray(IV_LENGTH + 16);
			const decipher = createDecipheriv(ALGORITHM, key, iv);

			decipher.setAuthTag(authTag);

			return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
		},
	};
};
