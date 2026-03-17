import { PasswordResetClient } from "@/components/PasswordResetClient";
import { getPasswordResetPresentationByToken } from "@/lib/auth/password-reset";

type ResetPasswordPageProps = {
  params: Promise<{ token: string }>;
};

export default async function ResetPasswordPage({ params }: ResetPasswordPageProps) {
  const { token } = await params;
  const presentation = await getPasswordResetPresentationByToken(token);

  return (
    <main className="section" style={{ maxWidth: "720px", marginTop: "8vh" }}>
      <PasswordResetClient token={token} initialReset={presentation} />
    </main>
  );
}
