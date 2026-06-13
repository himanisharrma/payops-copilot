import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { PayOpsWorkspace } from "@/components/payops-workspace";

export default async function Home() {
  const session = await auth();
  if (!session) redirect("/login");
  return (
    <PayOpsWorkspace
      canEdit={session.user.role !== "viewer"}
      userRole={session.user.role}
    />
  );
}
