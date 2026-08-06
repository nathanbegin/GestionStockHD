(() => {
  const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.109.0";
  const els = {
    loading: document.querySelector("#passwordLoading"),
    message: document.querySelector("#passwordMessage"),
    account: document.querySelector("#passwordAccount"),
    form: document.querySelector("#updatePasswordForm"),
    invalidActions: document.querySelector("#invalidRecoveryActions")
  };

  let authClient = null;
  let recoveryReady = false;
  let recoverySession = null;

  function recoveryContextFromUrl() {
    const search = new URLSearchParams(window.location.search);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return {
      hasRecoveryLink: search.has("code") || hash.get("type") === "recovery" || hash.has("access_token"),
      error: search.get("error_description") || hash.get("error_description") || search.get("error") || hash.get("error") || ""
    };
  }

  function setMessage(message, type = "info") {
    els.message.hidden = !message;
    els.message.className = `analysis-box password-message ${type}`;
    els.message.textContent = message || "";
  }

  function showInvalid(message) {
    recoveryReady = false;
    els.loading.hidden = true;
    els.form.hidden = true;
    els.account.hidden = true;
    els.invalidActions.hidden = false;
    setMessage(message || "Ce lien de récupération est invalide ou expiré. Demande un nouveau lien depuis la page de connexion.", "error");
  }

  function showRecoveryForm(session) {
    recoveryReady = true;
    recoverySession = session || recoverySession;
    els.loading.hidden = true;
    els.invalidActions.hidden = true;
    els.form.hidden = false;
    const email = recoverySession?.user?.email;
    if (email) {
      els.account.hidden = false;
      els.account.textContent = `Compte : ${email}`;
    }
    setMessage("");
    window.setTimeout(() => els.form.querySelector('[name="password"]')?.focus(), 50);
  }

  function loadSupabaseLibrary() {
    if (window.supabase?.createClient) return Promise.resolve(true);
    return new Promise(resolve => {
      const script = document.createElement("script");
      script.src = SUPABASE_CDN;
      script.async = true;
      script.onload = () => resolve(Boolean(window.supabase?.createClient));
      script.onerror = () => resolve(false);
      document.head.appendChild(script);
      window.setTimeout(() => resolve(Boolean(window.supabase?.createClient)), 8000);
    });
  }

  async function waitForRecoverySession(timeoutMs = 5000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const { data, error } = await authClient.auth.getSession();
      if (error) throw error;
      if (data.session) return data.session;
      await new Promise(resolve => window.setTimeout(resolve, 250));
    }
    return null;
  }

  async function initialize() {
    const context = recoveryContextFromUrl();
    if (context.error) return showInvalid(decodeURIComponent(context.error.replace(/\+/g, " ")));
    if (!context.hasRecoveryLink) return showInvalid("Ouvre cette page à partir du lien de récupération reçu par courriel.");

    try {
      const [libraryReady, configResponse] = await Promise.all([
        loadSupabaseLibrary(),
        fetch("/api/client-config", { cache: "no-store" })
      ]);
      if (!libraryReady) throw new Error("Impossible de charger le module de connexion Supabase.");

      const config = await configResponse.json().catch(() => ({}));
      if (!configResponse.ok || !config.enabled) throw new Error("Supabase Auth n’est pas configuré.");

      authClient = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      });

      authClient.auth.onAuthStateChange((event, session) => {
        if (event === "PASSWORD_RECOVERY") showRecoveryForm(session);
      });

      const session = await waitForRecoverySession();
      if (session) showRecoveryForm(session);
      else showInvalid();
    } catch (error) {
      showInvalid(error?.message || "Impossible de valider le lien de récupération.");
    }
  }

  els.form.addEventListener("submit", async event => {
    event.preventDefault();
    if (!recoveryReady || !authClient) return showInvalid();

    const form = event.currentTarget;
    const data = new FormData(form);
    const password = String(data.get("password") || "");
    const confirmation = String(data.get("passwordConfirm") || "");
    const button = form.querySelector('[type="submit"]');

    if (password.length < 8) return setMessage("Le nouveau mot de passe doit contenir au moins 8 caractères.", "error");
    if (password !== confirmation) return setMessage("Les mots de passe ne correspondent pas.", "error");

    button.disabled = true;
    button.textContent = "Enregistrement…";
    setMessage("");

    try {
      const { error } = await authClient.auth.updateUser({ password });
      if (error) throw error;

      recoveryReady = false;
      form.hidden = true;
      els.account.hidden = true;
      setMessage("Mot de passe modifié avec succès. Redirection vers la connexion…", "success");
      await authClient.auth.signOut({ scope: "local" }).catch(() => {});
      window.setTimeout(() => window.location.replace("/"), 1400);
    } catch (error) {
      setMessage(error?.message || "Impossible de modifier le mot de passe.", "error");
      button.disabled = false;
      button.textContent = "Enregistrer le nouveau mot de passe";
    }
  });

  initialize();
})();
