import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const SCRYPT_KEY_LENGTH = 64;

/**
 * Password hashing helpers for the local auth foundation.
 *
 * This keeps the implementation dependency-light while still using a
 * production-grade KDF instead of storing plaintext or reversible secrets.
 */
export const hashPassword = async (password: string): Promise<string> => {
	const salt = randomBytes(16).toString("hex");
	const derivedKey = (await scrypt(password, salt, SCRYPT_KEY_LENGTH)) as Buffer;

	return `${salt}:${derivedKey.toString("hex")}`;
};

/**
 * Verify a password against the persisted scrypt hash.
 */
export const verifyPassword = async ({
	password,
	passwordHash,
}: {
	password: string;
	passwordHash: string;
}): Promise<boolean> => {
	const [salt, expectedHex] = passwordHash.split(":");

	if (!salt || !expectedHex) {
		return false;
	}

	const expected = Buffer.from(expectedHex, "hex");
	const actual = (await scrypt(password, salt, expected.length)) as Buffer;

	if (expected.length !== actual.length) {
		return false;
	}

	return timingSafeEqual(expected, actual);
};
