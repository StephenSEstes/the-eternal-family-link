declare module "web-push" {
  export type WebPushSubscription = {
    endpoint: string;
    keys?: {
      p256dh?: string;
      auth?: string;
    };
  };

  export type SendOptions = {
    TTL?: number;
    urgency?: "very-low" | "low" | "normal" | "high";
    topic?: string;
  };

  export function setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  export function sendNotification(
    subscription: WebPushSubscription,
    payload?: string | Buffer | null,
    options?: SendOptions,
  ): Promise<unknown>;

  const webPush: {
    setVapidDetails: typeof setVapidDetails;
    sendNotification: typeof sendNotification;
  };

  export default webPush;
}
