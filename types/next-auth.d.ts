import "next-auth";

declare module "next-auth" {
  interface User {
    role: "admin" | "analyst" | "viewer";
    organizationId: string;
    organizationName: string;
  }

  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: "admin" | "analyst" | "viewer";
      organizationId: string;
      organizationName: string;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role: "admin" | "analyst" | "viewer";
    organizationId: string;
    organizationName: string;
  }
}
