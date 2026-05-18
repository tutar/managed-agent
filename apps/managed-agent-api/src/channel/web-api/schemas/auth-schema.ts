import { type Static, Type } from "@sinclair/typebox";

/**
 * Route schemas for authentication transport.
 *
 * Auth schemas stay in the web-api layer so login-session validation never
 * leaks into control-plane or worker code.
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

export type RegisterRequestSchemaDto = Static<typeof RegisterRequestSchema>;
export type LoginRequestSchemaDto = Static<typeof LoginRequestSchema>;
