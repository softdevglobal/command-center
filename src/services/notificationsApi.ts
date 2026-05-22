import {
  BMS_BLACK_API_URL,
  bmsBlackFetch,
  bmsBlackHeaders,
} from "@/services/bmsBlackApi";

const BASE_URL = BMS_BLACK_API_URL;

function apiHeaders(ownerUid?: string | null): Headers {
  return bmsBlackHeaders(ownerUid);
}

// ─── Types ───────────────────────────────────────────────────────────────────

export type CustomerNotification = {
  id: string;
  source: string;
  type:
    | "additional_issue_quote"
    | "estimate_reply"
    | "booking_completed"
    | string;
  title: string;
  message: string;
  read: boolean;
  createdAt: string;
  // booking / issue
  bookingId: string | null;
  bookingCode: string | null;
  issueId: string | null;
  issueTitle: string | null;
  price: number | null;
  estimateId: string | null;
  // customer
  customerId: string;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  workshopName: string;
  ownerUid: string | null;
  // review / call status
  notificationReviewed: boolean;
  calledCustomer: boolean;
  calledCustomerByName: string | null;
  calledCustomerByDisplayName: string | null;
  notificationReviewedByName: string | null;
  notificationReviewedByDisplayName: string | null;
};

// ─── Fetch ───────────────────────────────────────────────────────────────────

export async function fetchCustomerNotifications(): Promise<
  CustomerNotification[]
> {
  const res = await bmsBlackFetch(`${BASE_URL}/customer-notifications?all=1`, {
    headers: apiHeaders(),
  });

  if (!res.ok) {
    throw new Error(`fetchCustomerNotifications failed: ${res.status}`);
  }

  const json = await res.json();
  const raw: unknown[] = Array.isArray(json)
    ? json
    : (json.notifications ?? []);

  return raw.map((item) => {
    const d = item as Record<string, unknown>;
    const sourceRaw = String(d.source ?? "");
    let sourceObj: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(sourceRaw) as unknown;
      if (parsed && typeof parsed === "object") {
        sourceObj = parsed as Record<string, unknown>;
      }
    } catch {
      sourceObj = {};
    }
    const pickString = (...keys: string[]): string | null => {
      for (const key of keys) {
        const value = d[key] ?? sourceObj[key];
        if (value == null) continue;
        const text = String(value).trim();
        if (text) return text;
      }
      return null;
    };
    return {
      id: String(d.id ?? ""),
      source: sourceRaw,
      type: String(d.type ?? ""),
      title: String(d.title ?? ""),
      message: String(d.message ?? ""),
      read: Boolean(d.read),
      createdAt: String(d.createdAt ?? ""),
      bookingId: pickString("bookingId", "booking_id", "bmsBookingId", "bms_booking_id"),
      bookingCode: d.bookingCode ? String(d.bookingCode) : null,
      issueId: pickString("issueId", "issue_id", "additionalIssueId", "additional_issue_id"),
      issueTitle: d.issueTitle ? String(d.issueTitle) : null,
      price: d.price != null ? Number(d.price) : null,
      estimateId: d.estimateId ? String(d.estimateId) : null,
      customerId: String(d.customerId ?? ""),
      customerName: d.customerName ? String(d.customerName) : null,
      customerEmail: d.customerEmail ? String(d.customerEmail) : null,
      customerPhone: d.customerPhone ? String(d.customerPhone) : null,
      workshopName: String(d.workshopName ?? ""),
      ownerUid: d.ownerUid ? String(d.ownerUid) : null,
      notificationReviewed: Boolean(d.notificationReviewed),
      calledCustomer: Boolean(d.calledCustomer),
      calledCustomerByName: d.calledCustomerByName
        ? String(d.calledCustomerByName)
        : null,
      calledCustomerByDisplayName: d.calledCustomerByDisplayName
        ? String(d.calledCustomerByDisplayName)
        : null,
      notificationReviewedByName: d.notificationReviewedByName
        ? String(d.notificationReviewedByName)
        : null,
      notificationReviewedByDisplayName: d.notificationReviewedByDisplayName
        ? String(d.notificationReviewedByDisplayName)
        : null,
    } as CustomerNotification;
  });
}

// ─── Mark reviewed ────────────────────────────────────────────────────────────

export async function markNotificationReviewed(
  notificationId: string,
): Promise<void> {
  // console.log("[markNotificationReviewed] calling →", notificationId);
  const res = await bmsBlackFetch(
    `${BASE_URL}/customer-notifications/${notificationId}/notification-reviewed`,
    {
      method: "POST",
      headers: apiHeaders(),
    },
  );
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `markNotificationReviewed failed: ${res.status}${detail ? ` — ${detail}` : ""}`,
    );
  }
}

export async function markNotificationReviewedClosed(
  notificationId: string,
): Promise<void> {
  // console.log("[markNotificationReviewedClosed] calling →", notificationId);
  const res = await bmsBlackFetch(
    `${BASE_URL}/customer-notifications/${notificationId}/notification-reviewed`,
    {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ notificationReviewed: false }),
    },
  );
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `markNotificationReviewedClosed failed: ${res.status}${detail ? ` — ${detail}` : ""}`,
    );
  }
}

// ─── Mark called ─────────────────────────────────────────────────────────────

export async function markCalledCustomer(
  notificationId: string,
): Promise<void> {
  const res = await bmsBlackFetch(
    `${BASE_URL}/customer-notifications/${notificationId}/called-customer`,
    { method: "POST", headers: apiHeaders() },
  );
  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    throw new Error(
      `markCalledCustomer failed: ${res.status}${detail ? ` — ${detail}` : ""}`,
    );
  }
}

// ─── Additional issue customer response (booking resource) ───────────────────

async function readHttpErrorDetail(res: Response): Promise<string> {
  const text = await res.text();
  if (!text.trim()) return "";
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      const m = o.message ?? o.error ?? o.detail;
      if (typeof m === "string") return m;
    }
    return text.slice(0, 400);
  } catch {
    return text.slice(0, 400);
  }
}

export type AdditionalIssueCustomerResponse = "accept" | "reject";

/** JSON body from PATCH …/additional-issues/{issueId} on success. */
export type PatchAdditionalIssueCustomerResponseResult = {
  success: boolean;
  issueId: string;
  customerResponse: AdditionalIssueCustomerResponse;
  issueName: string;
  price: number;
};

/**
 * PATCH /bookings/{bookingId}/additional-issues/{issueId}
 * Body: { customerResponse: "accept" | "reject" }
 */
export async function patchBookingAdditionalIssueCustomerResponse(
  bookingId: string,
  issueId: string,
  customerResponse: AdditionalIssueCustomerResponse,
  options?: { ownerUid?: string | null },
): Promise<PatchAdditionalIssueCustomerResponseResult> {
  const headers = apiHeaders(options?.ownerUid);

  const res = await bmsBlackFetch(
    `${BASE_URL}/bookings/${encodeURIComponent(bookingId)}/additional-issues/${encodeURIComponent(issueId)}`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify({ customerResponse }),
    },
  );

  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    // console.warn(
    //   "[patchBookingAdditionalIssueCustomerResponse] HTTP error",
    //   res.status,
    //   detail || "(no body)",
    // );
    if (res.status === 409) {
      throw new Error(
        detail
          ? `This quote cannot be updated (${detail}). It may already have been accepted or rejected.`
          : "This quote cannot be updated — it may already have been accepted or rejected (409 Conflict).",
      );
    }
    throw new Error(
      `patchBookingAdditionalIssueCustomerResponse failed: ${res.status}${detail ? ` — ${detail}` : ""}`,
    );
  }

  const json = (await res.json()) as PatchAdditionalIssueCustomerResponseResult;
  if (json.success) {
    // console.log(
    //   "[patchBookingAdditionalIssueCustomerResponse] success",
    //   json,
    // );
  } else {
    // console.log(
    //   "[patchBookingAdditionalIssueCustomerResponse] not successful",
    //   json,
    // );
  }
  return json;
}

export type AdditionalIssuePriceStatus = "approved" | "rejected";

export type PatchAdditionalIssuePricePayload =
  | {
      status: "approved";
      price: number;
      customerPhone?: string;
      customerEmail?: string;
    }
  | {
      status: "rejected";
      customerPhone?: string;
      customerEmail?: string;
    };

export type PatchAdditionalIssuePriceResult = {
  success?: boolean;
  status?: AdditionalIssuePriceStatus;
  price?: number;
  [key: string]: unknown;
};

/**
 * PATCH /bookings/{bookingId}/additional-issues/{issueId}/price
 * Approve: { status: "approved", price: number >= 0 }
 * Reject:  { status: "rejected" }
 */
export async function patchBookingAdditionalIssuePrice(
  bookingId: string,
  issueId: string,
  payload: PatchAdditionalIssuePricePayload,
  options?: { ownerUid?: string | null },
): Promise<PatchAdditionalIssuePriceResult> {
  if (payload.status === "approved") {
    if (typeof payload.price !== "number" || Number.isNaN(payload.price)) {
      throw new Error("price is required when status is approved.");
    }
    if (payload.price < 0) {
      throw new Error("price must be >= 0 when status is approved.");
    }
  }

  const headers = apiHeaders(options?.ownerUid);

  const res = await bmsBlackFetch(
    `${BASE_URL}/bookings/${encodeURIComponent(bookingId)}/additional-issues/${encodeURIComponent(issueId)}/price`,
    {
      method: "PATCH",
      headers,
      body: JSON.stringify(payload),
    },
  );

  if (!res.ok) {
    const detail = await readHttpErrorDetail(res);
    if (res.status === 400) {
      throw new Error(
        detail
          ? `Invalid price update (${detail}).`
          : "Invalid price update (400). Check status/price rules.",
      );
    }
    throw new Error(
      `patchBookingAdditionalIssuePrice failed: ${res.status}${detail ? ` — ${detail}` : ""}`,
    );
  }

  return (await res.json()) as PatchAdditionalIssuePriceResult;
}
