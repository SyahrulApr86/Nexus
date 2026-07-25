import nodemailer from "nodemailer";
import { env } from "../env.js";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
}

const transport = nodemailer.createTransport({
  host: env.SMTP_HOST,
  port: env.SMTP_PORT,
  secure: false,
});

const sentForTests: OutgoingMail[] = [];
const isTest = process.env.NODE_ENV === "test" || !!process.env.VITEST;

/** Lets a test exercise the real failure path against a fake transport. */
type Deliver = (mail: OutgoingMail) => Promise<unknown>;
let deliverOverrideForTests: Deliver | null = null;

export function setMailDeliveryForTests(deliver: Deliver | null): void {
  deliverOverrideForTests = deliver;
}

/**
 * PRD edge case: delivery failure must not break the acknowledge-to-user
 * contract — send is fire-and-forget with retry left to the provider queue.
 */
export async function sendMail(mail: OutgoingMail): Promise<void> {
  const deliver: Deliver =
    deliverOverrideForTests ??
    (isTest
      ? async (m) => {
          sentForTests.push(m);
        }
      : (m) => transport.sendMail({ from: env.MAIL_FROM, ...m }));
  try {
    await deliver(mail);
  } catch (err) {
    console.error("mail delivery failed (acknowledged anyway):", err);
  }
}

export function getSentMailForTests(): readonly OutgoingMail[] {
  return sentForTests;
}

export function clearSentMailForTests(): void {
  sentForTests.length = 0;
}
