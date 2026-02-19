export { default } from "next-auth/middleware";

export const config = {
  matcher: ["/((?!viewer|api|_next/static|_next/image|favicon.ico).*)"],
};
