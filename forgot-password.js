(() => {
  const SUPABASE_CDN = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.109.0";
  const loginForm = document.querySelector("#loginForm");
  const signupForm = document.querySelector("#signupForm");
  const authTabs = document.querySelector(".auth-tabs");
  const authMessage = document.querySelector("#authMessage");
  const showLoginTab = document.querySelector("#showLoginTab");
  const showSignupTab = document.querySelector("#showSignupTab");
  if (!loginForm || !signupForm || !authTabs || !authMessage) return;

  const style = document.createElement("style");
  style.textContent = `
    .forgot-password-link {
      justify-self: end;
      margin: -4px 0 2px;
      padding: 0;
      border: 0;
      background: transparent;
      color: #bf4b00;
      font: inherit;
      font-size: .9rem;
      font-weight: 750;
      cursor: pointer;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    .forgot-password-link:hover { color: #8f3800; }
    .forgot-password-message { margin-top: 4px; }
  `;
  document.head.appendChild(style);

  const forgotLink = document.createElement("button");
  forgotLink.type = "button";
  forgotLink.className = "forgot-password-link";
  forgotLink.textContent = "Mot de passe oublié?";
  const loginButton = loginForm.querySelector('[type="submit"]');
  loginForm.insertBefore(forgotLink, loginButton);

  const forgotForm = document.createElement("form");
  forgotForm.id = "forgotPasswordForm";
  forgotForm.className = "auth-form";
  forgotForm.hidden = true;
  forgotForm.innerHTML = `
    <h2>Mot de passe oublié</h2>
    <p class="muted">Entre l’adresse courriel du compte. Un lien permettant de choisir un nouveau mot de passe sera envoyé.</p>
    <label>Courriel<input name="email" type="email" autocomplete="email" required placeholder="nom@magasin.ca"></label>
    <button class="button primary wide" type="submit">Envoyer le lien de récupération</button>
    <button class="button wide" type="button" data-forgot-action="back">Retour à la connexion</button>
    <div class="analysis-box forgot-password-message" role="status" aria-live="polite" hidden></div>
  `;
  authMessage.before(forgotForm);

  const localMessage = forgotForm.querySelector(".forgot-password-message");
  const emailInput = forgotForm.querySelector('[name="email"]');

  function setLocalMessage(message, type = "info") {
    localMessage.hidden = !message;
    localMessage.className = `analysis-box forgot-password-message ${type}`;
    localMessage.textContent = message || "";
  }

  function openForgotForm() {
    const loginEmail = loginForm.querySelector('[name="email"]')?.value || "";
    if (loginEmail) emailInput.value = loginEmail;
    loginForm.hidden = true;
    signupForm.hidden = true;
    authTabs.hidden = true;
    authMessage.hidden = true;
    forgotForm.hidden = false;
    setLocalMessage("");
    window.setTimeout(() => emailInput.focus(), 30);
  }

  function closeForgotForm() {
    forgotForm.hidden = true;
    authTabs.hidden = false;
    loginForm.hidden = false;
    signupForm.hidden = true;
    showLoginTab?.classList.add("active");
    showSignupTab?.classList.remove("active");
    setLocalMessage("");
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

  forgotLink.addEventListener("click", openForgotForm);
  forgotForm.querySelector('[data-forgot-action="back"]').addEventListener("click", closeForgotForm);
  showLoginTab?.addEventListener("click", () => { forgotForm.hidden = true; authTabs.hidden = false; });
  showSignupTab?.addEventListener("click", () => { forgotForm.hidden = true; authTabs.hidden = false; });

  forgotForm.addEventListener("submit", async event => {
    event.preventDefault();
    const button = forgotForm.querySelector('[type="submit"]');
    const email = String(new FormData(forgotForm).get("email") || "").trim();
    button.disabled = true;
    button.textContent = "Envoi…";
    setLocalMessage("");

    try {
      const [libraryReady, configResponse] = await Promise.all([
        loadSupabaseLibrary(),
        fetch("/api/client-config", { cache: "no-store" })
      ]);
      if (!libraryReady) throw new Error("Impossible de charger le module de connexion Supabase.");

      const config = await configResponse.json().catch(() => ({}));
      if (!configResponse.ok || !config.enabled) throw new Error("Supabase Auth n’est pas configuré.");

      const client = window.supabase.createClient(config.supabaseUrl, config.publishableKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      });

      const redirectTo = `${window.location.origin}/update-password`;
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;

      setLocalMessage("Si un compte correspond à cette adresse, un lien de récupération vient d’être envoyé. Vérifie aussi le dossier de courriels indésirables.", "success");
      forgotForm.reset();
    } catch (error) {
      setLocalMessage(error?.message || "Impossible d’envoyer le lien de récupération.", "error");
    } finally {
      button.disabled = false;
      button.textContent = "Envoyer le lien de récupération";
    }
  });
})();
