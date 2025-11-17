import { ImapFlow, FetchMessageObject } from "imapflow";
import { imapAccounts, ImapAccountConfig } from "../config/imapConfig.js";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FALLBACK_POLL_INTERVAL_MS = 15000;

interface AccountSyncState {
  lastSyncTime: Date;
  isSyncing: boolean;
}

/**
 * Log a short summary for debugging.
 */
function logMessageSummary(
  account: ImapAccountConfig,
  msg: FetchMessageObject,
  prefix = ""
): void {
  const subject = msg.envelope?.subject ?? "(no subject)";
  const from =
    msg.envelope?.from?.map((addr) => addr.address).join(", ") ?? "(unknown)";
  const date = msg.internalDate ? new Date(msg.internalDate).toISOString() : "";
  const uid = msg.uid ?? "?";

  console.log(
    `[IMAP][${account.label}]${prefix} uid=${uid} from=${from} date=${date} subject=${subject}`
  );
}

/**
 * Sync all messages with internalDate >= state.lastSyncTime.
 * Updates state.lastSyncTime to the newest message date.
 *
 * For Phase 1 we just log. In Phase 2+ you will:
 *   - normalize the email
 *   - store in DB
 *   - index into Elasticsearch
 */
async function syncSince(
  client: ImapFlow,
  account: ImapAccountConfig,
  state: AccountSyncState
): Promise<void> {
  if (!client.usable) {
    console.warn(
      `[IMAP][${account.label}] syncSince skipped; client not usable`
    );
    return;
  }

  const since = state.lastSyncTime;
  const now = new Date();

  console.log(
    `[IMAP][${account.label}] Running syncSince() from ${since.toISOString()}`
  );

  const lock = await client.getMailboxLock(account.mailbox);
  try {
    // SearchObject.since – IMAP server filters by internalDate. 
    const messages = await client.fetchAll(
      { since },
      {
        uid: true,
        envelope: true,
        internalDate: true,
        flags: true,
        size: true,
      }
    );

    if (!messages.length) {
      console.log(
        `[IMAP][${account.label}] syncSince() found no new messages`
      );
      // Move lastSyncTime forward a bit so the next search does not keep asking for exactly the same window forever.
      state.lastSyncTime = now;
      return;
    }

    let latestDate = state.lastSyncTime;

    for (const msg of messages) {
      logMessageSummary(account, msg, " [SYNC]");
      if (msg.internalDate && msg.internalDate > latestDate) {
        latestDate = msg.internalDate ? new Date(msg.internalDate) : new Date();
      }
    }

    state.lastSyncTime = latestDate;
    console.log(
      `[IMAP][${account.label}] syncSince() processed ${messages.length} messages. lastSyncTime -> ${state.lastSyncTime.toISOString()}`
    );
  } finally {
    lock.release();
  }
}

/**
 * Connect and keep an account in sync.
 * - Does initial 30-day sync
 * - Listens for "exists" events
 * - Uses a small fallback polling loop in case the server never fires events
 */
async function connectSingleAccount(account: ImapAccountConfig): Promise<void> {
  const client = new ImapFlow({
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: {
      user: account.user,
      pass: account.pass,
    },
    logger: false,
  });

  const state: AccountSyncState = {
    lastSyncTime: new Date(Date.now() - THIRTY_DAYS_MS),
    isSyncing: false,
  };

  client.on("error", (err) => {
    console.error(`[IMAP][${account.label}] Error`, err);
  });

  client.on("close", () => {
    console.warn(`[IMAP][${account.label}] Connection closed`);
  });

  await client.connect();
  console.log(
    `[IMAP][${account.label}] Connected. Opening mailbox "${account.mailbox}"`
  );

  const mailbox = await client.mailboxOpen(account.mailbox);
  console.log(
    `[IMAP][${account.label}] Mailbox opened: path=${mailbox.path}, exists=${mailbox.exists}, uidNext=${mailbox.uidNext}`
  );

  const capabilities = Array.from(client.capabilities.keys());
  console.log(
    `[IMAP][${account.label}] Server capabilities: ${capabilities.join(", ")}`
  );

  // ---- Initial 30-day sync ----
  await syncSince(client, account, state);

  // ---- Sync trigger helper ----
  const triggerSync = async () => {
    if (state.isSyncing) {
      return;
    }
    state.isSyncing = true;
    try {
      await syncSince(client, account, state);
    } catch (err) {
      console.error(
        `[IMAP][${account.label}] Error during syncSince()`,
        err
      );
    } finally {
      state.isSyncing = false;
    }
  };

  // ---- Event-based trigger (preferred if server sends EXISTS) ----
  client.on(
    "exists",
    async (info: { path: string; count: number; prevCount: number }) => {
      if (info.path !== account.mailbox) return;

      console.log(
        `[IMAP][${account.label}] exists event: prevCount=${info.prevCount} -> count=${info.count}`
      );

      void triggerSync();
    }
  );

  console.log(
    `[IMAP][${account.label}] Initial sync done. Listening for changes (IDLE / exists) and starting fallback polling...`
  );

  // ---- Fallback polling loop (for servers that do NOT send EXISTS/IDLE) ----
  setInterval(() => {
    if (!client.usable) return;
    void triggerSync();
  }, FALLBACK_POLL_INTERVAL_MS);
}

/**
 * Start IMAP sync for all configured accounts.
 */
export async function startImapSync(): Promise<void> {
  await Promise.all(
    imapAccounts.map(async (account) => {
      try {
        await connectSingleAccount(account);
      } catch (err) {
        console.error(
          `[IMAP][${account.label}] Failed to connect or sync`,
          err
        );
      }
    })
  );
}
