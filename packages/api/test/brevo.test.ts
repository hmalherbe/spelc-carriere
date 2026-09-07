import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { loadBrevoConfig, sendBrevoEmail, BrevoConfigError } from "../src/mailing/brevo.js";

describe("loadBrevoConfig", () => {
  it("throws a clear BrevoConfigError when BREVO_API_KEY is missing", () => {
    expect(() => loadBrevoConfig({})).toThrow(BrevoConfigError);
  });

  it("throws when BREVO_SENDER_EMAIL is missing", () => {
    expect(() => loadBrevoConfig({ BREVO_API_KEY: "xkeysib-test" })).toThrow(BrevoConfigError);
  });

  it("defaults the sender name to 'Spelc' when not provided", () => {
    const config = loadBrevoConfig({ BREVO_API_KEY: "xkeysib-test", BREVO_SENDER_EMAIL: "contact@spelc.example" });
    expect(config).toEqual({ apiKey: "xkeysib-test", senderEmail: "contact@spelc.example", senderName: "Spelc" });
  });

  it("uses BREVO_SENDER_NAME when provided", () => {
    const config = loadBrevoConfig({
      BREVO_API_KEY: "xkeysib-test",
      BREVO_SENDER_EMAIL: "contact@spelc.example",
      BREVO_SENDER_NAME: "Spelc Nice",
    });
    expect(config.senderName).toBe("Spelc Nice");
  });
});

describe("sendBrevoEmail", () => {
  const config = { apiKey: "xkeysib-test", senderEmail: "contact@spelc.example", senderName: "Spelc" };

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the expected payload and headers to Brevo's transactional email endpoint", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ messageId: "brevo-msg-1" }),
    });

    const result = await sendBrevoEmail(config, {
      to: { email: "irene.aboud@example.com", name: "Irene ABOUD" },
      subject: "Sujet",
      html: "<p>Corps</p>",
    });

    expect(result).toEqual({ messageId: "brevo-msg-1" });
    expect(fetch).toHaveBeenCalledWith(
      "https://api.brevo.com/v3/smtp/email",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ "api-key": "xkeysib-test", "Content-Type": "application/json" }),
      }),
    );
    const body = JSON.parse((fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body).toEqual({
      sender: { email: "contact@spelc.example", name: "Spelc" },
      to: [{ email: "irene.aboud@example.com", name: "Irene ABOUD" }],
      subject: "Sujet",
      htmlContent: "<p>Corps</p>",
    });
  });

  it("throws with the response body when Brevo returns a non-2xx status", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"message":"Key not found"}',
    });

    await expect(
      sendBrevoEmail(config, { to: { email: "x@example.com" }, subject: "s", html: "h" }),
    ).rejects.toThrow(/401/);
  });
});
