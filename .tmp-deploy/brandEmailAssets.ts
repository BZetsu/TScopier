/** Public Storage URLs for TScopier brand images in emails. */

export const EMAIL_ASSETS_BUCKET = "email-assets";

export type EmailLogoVariant = "light" | "dark" | "mark";

const LOGO_FILES: Record<EmailLogoVariant, string> = {
  light: "tscopierlogo.png",
  dark: "tscopierlogo-dark.png",
  mark: "tslogo-collapse.png",
};

export function emailAssetsPublicBase(supabaseUrl: string): string {
  return `${String(supabaseUrl).replace(/\/$/, "")}/storage/v1/object/public/${EMAIL_ASSETS_BUCKET}`;
}

export function emailBrandLogoUrl(
  supabaseUrl: string,
  variant: EmailLogoVariant = "light",
): string {
  return `${emailAssetsPublicBase(supabaseUrl)}/${LOGO_FILES[variant]}`;
}

/** Prefer explicit override, then Storage, then app-hosted fallback. */
export function resolveEmailLogoUrl(args: {
  supabaseUrl: string;
  appUrl?: string | null;
  variant?: EmailLogoVariant;
  explicitUrl?: string | null;
}): string {
  const explicit = String(args.explicitUrl ?? "").trim();
  if (explicit) return explicit;

  const supabaseUrl = String(args.supabaseUrl ?? "").trim();
  if (supabaseUrl) {
    return emailBrandLogoUrl(supabaseUrl, args.variant ?? "light");
  }

  const appUrl = String(args.appUrl ?? "https://app.tscopier.ai").replace(/\/$/, "");
  const file = LOGO_FILES[args.variant ?? "light"];
  return `${appUrl}/${file}`;
}
