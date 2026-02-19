import "server-only";

import { google } from "googleapis";
import { getEnv } from "@/lib/env";

type ServiceAccount = {
  client_email: string;
  private_key: string;
};

let jwtClient: InstanceType<typeof google.auth.JWT> | null = null;

export function getServiceAccountAuth() {
  if (jwtClient) {
    return jwtClient;
  }

  const env = getEnv();
  const credentials = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON) as ServiceAccount;
  const privateKey = credentials.private_key.replace(/\\n/g, "\n");

  jwtClient = new google.auth.JWT({
    email: credentials.client_email,
    key: privateKey,
    scopes: [
      "https://www.googleapis.com/auth/spreadsheets",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
  });

  return jwtClient;
}
