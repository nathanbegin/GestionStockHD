# Sécurité - Version 5

## Authentification

La V5 utilise Supabase Auth avec courriel et mot de passe. Le navigateur reçoit un jeton d’accès Supabase et l’envoie aux fonctions Vercel avec l’en-tête `Authorization: Bearer ...`.

Chaque fonction protégée :

1. valide le jeton auprès de Supabase Auth;
2. charge le profil correspondant;
3. vérifie que le compte est approuvé;
4. vérifie le rôle lorsque l’action est réservée à un superviseur ou à un administrateur.

## Autorisation

Les rôles et l’état d’approbation sont enregistrés dans `public.profiles`, et non dans les métadonnées modifiables par l’utilisateur.

- `employee` : opérations courantes;
- `supervisor` : approbations et attributions;
- `admin` : rôles et réglages globaux.

Un superviseur ne peut pas promouvoir un utilisateur superviseur ou administrateur et ne peut pas modifier un administrateur. La fonction de synchronisation conserve aussi les affectations et réglages protégés lorsqu’un compte employé envoie son état local.

## Clés

Ne jamais exposer dans le navigateur ou commiter :

- `SUPABASE_SECRET_KEY`;
- `OPENAI_API_KEY`;
- `APP_PIN`;
- les fichiers `.env` ou `.env.local`.

`SUPABASE_PUBLISHABLE_KEY` est une clé destinée au navigateur. La protection des données repose toutefois sur l’authentification, les vérifications serveur et les règles d’accès.

## Premier administrateur

La méthode recommandée est `BOOTSTRAP_ADMIN_EMAIL`.

La méthode `APP_PIN` ne fonctionne que lorsqu’aucun administrateur approuvé n’existe. Utilisez un code long et retirez cette variable après l’initialisation, si elle n’est plus nécessaire.

## Base de données

Les tables `app_state` et `profiles` activent RLS et retirent l’accès direct aux rôles `anon` et `authenticated`. Les opérations applicatives passent par les fonctions Vercel avec la clé secrète Supabase.

## Photos

Le bucket `stock-location-photos` est privé. Les images sont ouvertes avec des URL signées temporaires générées par une fonction Vercel après validation de l’utilisateur.

## Rapports PDF

Le PDF est généré sur le serveur à partir de l’état cloud. La fonction vérifie que l’utilisateur est connecté et approuvé avant de produire le document.

## Recommandations de production

- conserver la confirmation de courriel;
- configurer des mots de passe robustes dans Supabase Auth;
- activer la protection contre les mots de passe compromis si disponible dans votre forfait;
- limiter les domaines de redirection Auth;
- surveiller les journaux Vercel et Supabase;
- créer une politique de conservation de l’historique et des photos;
- révoquer immédiatement les comptes des employés qui quittent l’organisation;
- envisager MFA pour les administrateurs et superviseurs;
- migrer vers des tables relationnelles dédiées si le nombre d’utilisateurs ou la concurrence augmente fortement.
