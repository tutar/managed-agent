import { type Static, Type } from "@sinclair/typebox";
import { ValidationError } from "../api-channel/http-errors.js";

/**
 * Transport DTOs and route schemas for authentication endpoints.
 *
 * Login session transport stays separate from managed agent session transport
 * so auth can evolve without leaking agent-runtime concerns into this layer.
 */
const USERNAME_MIN_LENGTH = 3;
const PASSWORD_MIN_LENGTH = 7;

export const RegisterRequestSchema = Type.Object({
	username: Type.String({ minLength: USERNAME_MIN_LENGTH }),
	password: Type.String({ minLength: PASSWORD_MIN_LENGTH }),
});

export const LoginRequestSchema = Type.Object({
	username: Type.String({ minLength: USERNAME_MIN_LENGTH }),
	password: Type.String({ minLength: PASSWORD_MIN_LENGTH }),
});

export const CurrentUserResponseSchema = Type.Object({
	userId: Type.String(),
	username: Type.String(),
	status: Type.String(),
	createdAt: Type.String(),
	lastLoginAt: Type.Union([Type.String(), Type.Null()]),
});

export const LogoutResponseSchema = Type.Object({
	loggedOut: Type.Literal(true),
});

export type RegisterRequestDto = Static<typeof RegisterRequestSchema>;
export type LoginRequestDto = Static<typeof LoginRequestSchema>;
export type CurrentUserResponseDto = Static<typeof CurrentUserResponseSchema>;
export type LogoutResponseDto = Static<typeof LogoutResponseSchema>;

/**
 * Normalize auth payloads after schema validation.
 *
 * Schema validation guarantees the shape, while this mapper preserves the
 * previous trimming behavior for usernames without keeping a second validator.
 */
const normalizeAuthRequest = <T extends RegisterRequestDto | LoginRequestDto>(input: T): T => {
	const normalizedUsername = input.username.trim();

	if (normalizedUsername.length < USERNAME_MIN_LENGTH) {
		throw new ValidationError(`username must be at least ${USERNAME_MIN_LENGTH} characters`);
	}

	return {
		...input,
		username: normalizedUsername,
	};
};

/** Normalize a register request after Fastify schema validation. */
export const toRegisterRequestDto = (input: RegisterRequestDto): RegisterRequestDto => {
	return normalizeAuthRequest(input);
};

/** Normalize a login request after Fastify schema validation. */
export const toLoginRequestDto = (input: LoginRequestDto): LoginRequestDto => {
	return normalizeAuthRequest(input);
};

/** Map an authenticated user record into the HTTP response payload. */
export const toCurrentUserResponseDto = (user: {
	userId: string;
	username: string;
	status: string;
	createdAt: string;
	lastLoginAt: string | null;
}): CurrentUserResponseDto => {
	return {
		userId: user.userId,
		username: user.username,
		status: user.status,
		createdAt: user.createdAt,
		lastLoginAt: user.lastLoginAt,
	};
};

/** Build the logout response used by the HTTP route. */
export const toLogoutResponseDto = (): LogoutResponseDto => {
	return {
		loggedOut: true,
	};
};
