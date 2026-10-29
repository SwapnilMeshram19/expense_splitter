/**
 * Google sign-in for the web: Google Identity Services (GIS) gives an ID token in the page, the
 * same kind of token the Android app gets from Credential Manager. Auth then runs exactly as in
 * the app (linkIdentity / signInWithIdToken with a nonce), with no redirect through the Supabase
 * domain and no client secret.
 *
 * Needs, in Google Cloud → Credentials → the Web client → Authorized JavaScript origins:
 * https://split.ssoftapp.in and http://localhost:5173 (and http://localhost).
 *
 * The script is loaded only when the Account screen shows the button, so other pages make no
 * request to Google.
 */
const SCRIPT_URL = 'https://accounts.google.com/gsi/client';

interface CredentialResponse {
  credential?: string;
}

interface GoogleAccountsId {
  initialize(config: {
    client_id: string;
    callback: (response: CredentialResponse) => void;
    nonce?: string;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    use_fedcm_for_button?: boolean;
    itp_support?: boolean;
  }): void;
  renderButton(
    parent: HTMLElement,
    options: {
      type?: 'standard';
      theme?: 'outline' | 'filled_blue' | 'filled_black';
      size?: 'large';
      text?: 'continue_with' | 'signin_with';
      shape?: 'pill' | 'rectangular';
      width?: number;
      logo_alignment?: 'left';
    },
  ): void;
  disableAutoSelect(): void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GoogleAccountsId } };
  }
}

let loading: Promise<GoogleAccountsId> | null = null;

export const googleClientId = (): string | null => {
  const id = (import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID ?? '').trim();
  return id.endsWith('.apps.googleusercontent.com') ? id : null;
};

function loadGis(): Promise<GoogleAccountsId> {
  loading ??= new Promise<GoogleAccountsId>((resolve, reject) => {
    const ready = () => {
      const api = window.google?.accounts?.id;
      if (api) resolve(api);
      else reject(new Error('Google sign-in did not load'));
    };
    if (window.google?.accounts?.id) return ready();
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.onload = ready;
    script.onerror = () => {
      loading = null; // let a later visit try again (offline, blocker)
      reject(new Error('Google sign-in did not load'));
    };
    document.head.appendChild(script);
  });
  return loading;
}

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return toHex(new Uint8Array(digest));
}

/**
 * Render Google's button into `parent`. Each click that completes calls `onToken` with the ID token
 * and the raw nonce (Google embeds SHA-256(rawNonce) in the token; Supabase checks it, which stops a
 * token captured elsewhere from being replayed here). The button is re-armed with a fresh nonce
 * after every use.
 */
export async function renderGoogleButton(
  parent: HTMLElement,
  onToken: (idToken: string, rawNonce: string) => void,
): Promise<void> {
  const clientId = googleClientId();
  if (!clientId) throw new Error('Google sign-in is not configured');
  const gis = await loadGis();

  const arm = async () => {
    const rawNonce = toHex(crypto.getRandomValues(new Uint8Array(32)));
    gis.initialize({
      client_id: clientId,
      nonce: await sha256Hex(rawNonce),
      auto_select: false,
      cancel_on_tap_outside: true,
      use_fedcm_for_button: true,
      itp_support: true,
      callback: (response) => {
        if (response.credential) onToken(response.credential, rawNonce);
        void arm();
      },
    });
    parent.replaceChildren();
    gis.renderButton(parent, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      logo_alignment: 'left',
      width: Math.min(320, Math.max(200, parent.clientWidth || 280)),
    });
  };
  await arm();
}

/** After sign-out: don't sign the next person on this browser in automatically. */
export function forgetGoogleChoice(): void {
  window.google?.accounts?.id?.disableAutoSelect();
}
