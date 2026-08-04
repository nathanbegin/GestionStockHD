(() => {
  let signupClientPromise = null;

  function setSignupMessage(message, type = "info") {
    const box = document.querySelector("#authMessage");
    if (!box) return;
    box.hidden = !message;
    box.className = `analysis-box auth-message ${type}`;
    box.textContent = message || "";
  }

  async function ensureSupabaseLibrary() {
    if (window.supabase?.createClient) return;

    const existing = document.querySelector('script[src*="@supabase/supabase-js"]');
    if (existing) {
      await new Promise((resolve, reject) => {
        if (window.supabase?.createClient) return resolve();
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", () => reject(new Error("Impossible de charger Supabase")), { once: true });
        setTimeout(() => window.supabase?.createClient ? resolve() : reject(new Error("Délai de chargement Supabase dépassé")), 8000);
      });
      return;
    }

    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.109.0";
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Impossible de charger Supabase"));
      document.head.appendChild(script);
    });
  }

  async function getSignupClient() {
    if (signupClientPromise) return signupClientPromise;

    signupClientPromise = (async () => {
      await ensureSupabaseLibrary();
      const response = await fetch("/api/client-config", { cache: "no-store" });
      const config = await response.json();
      if (!response.ok || !config.enabled || !config.supabaseUrl || !config.publishableKey) {
        throw new Error("Supabase Auth n’est pas configuré dans Vercel");
      }

      return window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });
    })();

    return signupClientPromise;
  }

  document.addEventListener("submit", async event => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "signupForm") return;

    event.preventDefault();
    event.stopImmediatePropagation();

    const button = form.querySelector('[type="submit"]');
    const data = new FormData(form);
    const password = String(data.get("password") || "");
    const passwordConfirm = String(data.get("passwordConfirm") || "");

    if (password !== passwordConfirm) {
      setSignupMessage("Les mots de passe ne correspondent pas.", "error");
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = "Envoi…";
    }
    setSignupMessage("");

    try {
      const client = await getSignupClient();
      const { data: result, error } = await client.auth.signUp({
        email: String(data.get("email") || "").trim(),
        password,
        options: {
          data: {
            full_name: String(data.get("fullName") || "").trim()
          },
          emailRedirectTo: `${window.location.origin}/`
        }
      });

      if (error) throw error;

      if (result.session) {
        window.location.reload();
        return;
      }

      setSignupMessage(
        "Demande créée. Confirme ton courriel si Supabase t’a envoyé un message, puis reconnecte-toi. L’accès restera en attente d’approbation.",
        "success"
      );
      form.reset();
    } catch (error) {
      setSignupMessage(error?.message || "Inscription impossible", "error");
    } finally {
      if (button) {
        button.disabled = false;
        button.textContent = "Envoyer la demande";
      }
    }
  }, true);
})();
