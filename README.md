# Remplissage magasin V5

Application web mobile/PWA pour relever, attribuer et traiter des articles à remplir en magasin.

## Nouveautés de la version 5

- Connexion par courriel et mot de passe avec Supabase Auth.
- Page d’inscription publique.
- Demandes d’accès en attente jusqu’à l’approbation d’un superviseur ou d’un administrateur.
- Rôles : employé, superviseur et administrateur, avec restrictions appliquées dans l’interface et lors de la synchronisation serveur.
- Bouton de déconnexion visible dans l’interface, y compris dans la PWA mobile.
- Onglet Attribution des articles.
- Listes de ramassage personnalisées.
- Attribution d’une liste de ramassage à un ou plusieurs employés.
- Vérification du permis de chariot élévateur.
- Historique des ajouts, modifications, attributions, récupérations et remplissages.
- Rapports PDF des listes de ramassage, incluant le lieu du ramassage et la destination en tablette.
- Synchronisation automatique et mise à jour en direct des appareils connectés.
- Photo privée de l’emplacement d’entreposage.

## Rôles

### Employé

- ajouter et modifier des articles;
- mettre à jour les statuts;
- consulter les attributions;
- créer ses propres listes de ramassage;
- effectuer une tournée et exporter son rapport PDF;
- consulter l’historique.

### Superviseur

- toutes les fonctions d’un employé;
- attribuer des articles;
- approuver ou refuser les nouvelles demandes d’accès;
- modifier les permis de lift;
- gérer les listes source et les départements.

Un superviseur approuve les nouvelles demandes comme employés. Seul un administrateur peut octroyer le rôle superviseur ou administrateur.

### Administrateur

- toutes les fonctions du superviseur;
- modifier les rôles;
- modifier l’état des comptes;
- modifier les réglages généraux du magasin.

## Mise à niveau depuis la V4.1

Les données d’articles, listes, départements, employés, photos et statuts existants sont conservées dans `app_state`.

La V5 remplace la connexion par nom et PIN par Supabase Auth. Les utilisateurs doivent donc créer un compte avec leur courriel.

### 1. Remplacer les fichiers du dépôt

Copiez le contenu de cette version dans votre dépôt Git relié à Vercel.

### 2. Exécuter le nouveau schéma SQL

Dans Supabase :

1. ouvrez **SQL Editor**;
2. créez une nouvelle requête;
3. copiez le contenu de `supabase/schema.sql`;
4. exécutez la requête.

Le script :

- conserve la table `app_state` existante;
- crée la table `profiles`;
- crée automatiquement un profil en attente lors d’une inscription Supabase Auth;
- crée les profils manquants pour les comptes Auth déjà existants;
- conserve ou crée le bucket privé des photos d’emplacement.

### 3. Configurer Supabase Auth

Dans Supabase, vérifiez que la connexion par courriel et mot de passe est activée.

Configurez aussi :

- l’URL du site avec votre domaine Vercel;
- les URL de redirection autorisées pour votre domaine de production et vos domaines Preview, si utilisés.

La confirmation de courriel peut rester activée. Dans ce cas, l’utilisateur doit d’abord confirmer son courriel, puis se connecter; son compte demeure ensuite en attente d’approbation dans l’application.

### 4. Variables Vercel

Ajoutez ou conservez :

```text
SUPABASE_URL=https://VOTRE-PROJET.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
OPENAI_API_KEY=...
OPENAI_VISION_MODEL=gpt-5-nano
```

Pour le premier administrateur, utilisez l’une de ces méthodes.

#### Méthode recommandée

```text
BOOTSTRAP_ADMIN_EMAIL=admin@votre-magasin.ca
```

Le compte inscrit avec ce courriel est automatiquement approuvé comme administrateur lors de sa première connexion.

#### Méthode de secours

```text
APP_PIN=un-long-code-d-installation
```

Lorsque aucun administrateur n’existe, le premier utilisateur connecté en attente verra un formulaire permettant d’entrer ce code. Dès qu’un administrateur existe, cette promotion initiale est bloquée.

### 5. Redéployer

Après les changements de variables, redéployez l’application dans Vercel.

Fermez complètement l’ancienne PWA, puis rouvrez-la. Si l’ancienne interface reste en cache, retirez et réinstallez la PWA ou videz les données du site. Le nouveau cache s’appelle `remplissage-v5`.

## Approbation des utilisateurs

1. L’utilisateur ouvre la page d’inscription.
2. Il entre son nom, son courriel et son mot de passe.
3. Le profil est créé avec l’état `pending`.
4. Après connexion, une page lui indique que sa demande est en attente.
5. Un superviseur ou un administrateur ouvre **Plus → Utilisateurs**.
6. Il approuve ou refuse la demande.
7. L’utilisateur clique sur **Vérifier l’approbation** ou se reconnecte.

## Listes de ramassage personnalisées

Une liste peut être créée :

- depuis l’onglet **Ramassages**;
- en sélectionnant plusieurs articles dans **Articles**, puis en cliquant sur **Créer un ramassage**.

La liste contient :

- un nom;
- un point de départ ou une zone;
- les articles inclus;
- les employés responsables;
- les lieux individuels de ramassage;
- les destinations en tablette.

Le bouton **PDF** produit un rapport téléchargeable avec ces informations.

## Architecture

- Interface statique/PWA : `index.html`, `app.js`, `styles.css`.
- Authentification : Supabase Auth.
- Profils et rôles : `public.profiles`.
- État collaboratif : `public.app_state`.
- Photos : bucket privé `stock-location-photos`.
- Fonctions Vercel :
  - `api/client-config.js`;
  - `api/me.js`;
  - `api/bootstrap-admin.js`;
  - `api/users.js`;
  - `api/sync.js`;
  - `api/report-pdf.js`;
  - fonctions d’analyse et de photos.

Les clés secrètes Supabase et OpenAI ne sont jamais envoyées au navigateur. Les fonctions Vercel valident le jeton Supabase Auth avant d’accéder aux données. La synchronisation empêche notamment un employé de modifier les affectations, la structure du magasin ou les réglages réservés aux rôles supérieurs.

## Développement local

```bash
npm install
vercel dev
```

Créez un fichier `.env.local` à partir de `.env.example`.

## Limites actuelles

- L’état opérationnel principal demeure un document JSON partagé dans `app_state`; cette architecture convient à un MVP ou à un magasin de taille modérée.
- En cas de très grand volume ou de nombreuses modifications simultanées, une migration vers des tables relationnelles distinctes pour les articles, listes et historiques serait recommandée.
- Les permis enregistrés constituent une vérification administrative interne et ne remplacent pas les exigences de formation, d’autorisation et de sécurité de l’employeur.
