import { PasswordResetClient } from "@/components/PasswordResetClient";
import { getPasswordResetPresentationByToken } from "@/lib/auth/password-reset";

export default async function ResetPasswordPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const presentation = await getPasswordResetPresentationByToken(token);
  return <PasswordResetClient token={token} initialReset={presentation} />;
}
