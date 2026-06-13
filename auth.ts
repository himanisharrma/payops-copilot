import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { query } from "@/lib/db";

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET ?? "local-payops-demo-secret-change-me",
  pages: { signIn: "/login" },
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const parsed = credentialsSchema.safeParse(credentials);
        if (!parsed.success) return null;
        const result = await query<{
          id: string;
          name: string;
          email: string;
          password_hash: string;
          role: "admin" | "analyst" | "viewer";
          organization_id: string;
          organization_name: string;
        }>(
          `SELECT u.*, o.name AS organization_name
           FROM users u JOIN organizations o ON o.id = u.organization_id
           WHERE LOWER(u.email) = LOWER($1) AND u.active = TRUE`,
          [parsed.data.email],
        );
        const user = result.rows[0];
        if (!user || !(await bcrypt.compare(parsed.data.password, user.password_hash))) {
          return null;
        }
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          organizationId: user.organization_id,
          organizationName: user.organization_name,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.role = user.role;
        token.organizationId = user.organizationId;
        token.organizationName = user.organizationName;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub!;
      session.user.role = token.role as "admin" | "analyst" | "viewer";
      session.user.organizationId = token.organizationId as string;
      session.user.organizationName = token.organizationName as string;
      return session;
    },
  },
});
