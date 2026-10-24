export const captureProfile = {
  profile_id: "capture.chatgpt.visible-selection",
  profile_version: "0.1.1-public.1",
  origin: "https://chatgpt.com",
  role_selector: "section[data-testid^=\"conversation-turn-\"] div[data-message-author-role=\"user\"], section[data-testid^=\"conversation-turn-\"] div[data-message-author-role=\"assistant\"]",
  dom_contract_version: "chatgpt-message-dom/v0.1",
  text_normalization: "unicode-nfkc-whitespace-v0.1",
  max_request_bytes: 196_608,
  max_turn_bytes: 16_384,
  max_turns: 64,
} as const;

export type CaptureRole = "owner" | "assistant" | "quoted_external" | "unknown";

export interface CaptureRoleProof {
  readonly selector: typeof captureProfile.role_selector;
  readonly raw_role: "user" | "assistant";
  readonly quoted: boolean;
  readonly visible: true;
}

export interface CapturedTurn {
  readonly turn_id: string;
  readonly order: number;
  readonly role: CaptureRole;
  readonly text: string;
  readonly role_proof: CaptureRoleProof;
}

export interface ChatGptCapturePack {
  readonly schema_version: "chatgpt-capture-pack/v0.1";
  readonly capture_profile_id: "capture.chatgpt.visible-selection";
  readonly capture_profile_version: "0.1.1-public.1";
  readonly page_origin: "https://chatgpt.com";
  readonly conversation_ref: string;
  readonly captured_at: string;
  readonly selected_turn_ids: readonly string[];
  readonly turns: readonly CapturedTurn[];
  readonly retention: "local_raw_until_submit";
}

export interface ValidatedCapturePack {
  readonly pack: ChatGptCapturePack;
  readonly conversation_ref: string;
  readonly selected_turn_digest: string;
  readonly owner_turn_digest: string;
  readonly capture_digest: string;
  readonly role_summary: readonly {
    readonly role: Exclude<CaptureRole, "unknown">;
    readonly count: number;
  }[];
}
