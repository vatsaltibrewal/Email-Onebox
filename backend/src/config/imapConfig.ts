import 'dotenv/config';

export interface ImapAccountConfig {
  id: string;
  label: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  mailbox: string;
}

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const baseHost = requireEnv("IMAP_HOST");
const basePort = Number(requireEnv("IMAP_PORT"));
const secure = (process.env.IMAP_SECURE ?? "true").toLowerCase() !== "false";

export const imapAccounts: ImapAccountConfig[] = [
  {
    id: "account1",
    label: "MailSlurp Inbox 1",
    host: baseHost,
    port: basePort,
    secure,
    user: requireEnv("IMAP_ACCOUNT_1_USER"),
    pass: requireEnv("IMAP_ACCOUNT_1_PASS"),
    mailbox: process.env.IMAP_ACCOUNT_1_MAILBOX || "INBOX",
  },
  {
    id: "account2",
    label: "MailSlurp Inbox 2",
    host: baseHost,
    port: basePort,
    secure,
    user: requireEnv("IMAP_ACCOUNT_2_USER"),
    pass: requireEnv("IMAP_ACCOUNT_2_PASS"),
    mailbox: process.env.IMAP_ACCOUNT_2_MAILBOX || "INBOX",
  },
];
