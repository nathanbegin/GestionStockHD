# Remplissage magasin V5

Application web mobile/PWA de gestion du remplissage en magasin. Elle permet de relever les articles à remplir, les attribuer aux employés, préparer des listes de ramassage, suivre leur progression et coordonner le travail d’équipe.

## Fonctionnalités principales

### Articles et relevés

- Ajout manuel d’articles ou analyse d’une photo d’étiquette.
- Extraction du numéro d’article (SKU) et des informations utiles à partir d’une photo.
- Classement par liste source et département.
- Priorités : élevée, normale ou faible.
- Statuts : À remplir, Récupéré, Rempli et Introuvable.
- Recherche et filtres par liste, département, statut, priorité et employé.
- Modification en lot de plusieurs articles.
- Photo privée de l’emplacement d’entreposage.

### Attribution et ramassage

- Attribution d’articles à un ou plusieurs employés.
- Listes de ramassage personnalisées.
- Création d’une liste directement à partir d’une sélection d’articles.
- Attribution d’une liste de ramassage à un ou plusieurs employés.
- Lieu de ramassage et destination en tablette pour chaque article.
- Tournée de ramassage adaptée à l’utilisation mobile.
- Vérification du permis de chariot élévateur lorsqu’un article le requiert.
- Rapports PDF organisés pour faciliter le travail sur le plancher.

### Événements

- Onglet **Événements** avec événements à venir et passés.
- Création et gestion d’événements par les rôles autorisés.
- Date, heure, lieu, description et participants.
- Association d’une ou plusieurs listes de ramassage à un événement.
- Inscription et désinscription des employés.
- Affichage de la progression des listes liées.
- Gestion des événements annulés.
- Notifications liées aux inscriptions et aux changements d’événements.

### Collaboration et suivi

- Synchronisation automatique avec Supabase.
- Mise à jour en direct des appareils connectés.
- Historique des ajouts, modifications, attributions, récupérations et remplissages.
- Gestion centralisée des listes, départements, employés et paramètres du magasin.
- Interface responsive optimisée pour téléphone, tablette et ordinateur.
- PWA installable avec fonctionnement local lorsque la connexion est temporairement indisponible.
- Navigation mobile et menu hamburger sur ordinateur.

### Apparence

Dans **Réglages → Apparence**, chaque appareil peut utiliser :

- les palettes Orange, Bleu, Vert ou Violet;
- le mode clair ou le mode nuit.

Les préférences d’apparence sont enregistrées localement sur l’appareil.

## Comptes et rôles

L’authentification utilise **Supabase Auth** avec courriel et mot de passe. Une nouvelle inscription reste en attente jusqu’à son approbation.

### Employé

- ajouter et modifier des articles;
- mettre à jour les statuts;
- consulter ses attributions;
- créer ses propres listes de ramassage;
- effectuer une tournée et exporter un rapport PDF;
- consulter l’historique;
- consulter les événements et s’y inscrire.

### Superviseur

Toutes les fonctions d’un employé, plus :

- attribuer des articles;
- approuver ou refuser les nouvelles demandes d’accès;
- modifier les permis de chariot élévateur;
- gérer les listes source et les départements;
- gérer les fonctions de coordination réservées aux rôles supérieurs.

Un superviseur approuve les nouvelles demandes comme employés. Seul un administrateur peut octroyer le rôle de superviseur ou d’administrateur.

### Administrateur

Toutes les fonctions du superviseur, plus :

- modifier les rôles;
- modifier l’état des comptes;
- modifier les réglages généraux du magasin.

## Mise à niveau depuis la V4.1

Les données d’articles, listes, départements, employés, photos et statuts existants sont conservées dans `app_state`.

La V5 remplace la connexion par nom et PIN par Supabase Auth. Les utilisateurs doivent donc créer un compte avec leur courriel.

### 1. Mettre à jour les fichiers

Déployez le contenu actuel de ce dépôt dans le projet Vercel relié à l’application.

### 2. Exécuter le schéma SQL

Dans Supabase :

1. ouvrez **SQL Editor**;
2. créez une nouvelle requête;
3. copiez le contenu de `supabase/schema.sql`;
4. exécutez la requête.

Le script principal :

- conserve la table `app_state` existante;
- crée et maintient la table `profiles`;
- crée automatiquement un profil en attente lors d’une inscription Supabase Auth;
- crée les profils manquants pour les comptes Auth déjà existants;
- conserve ou crée le bucket privé des photos d’emplacement.

Si le dépôt contient des migrations SQL additionnelles correspondant à des fonctions ajoutées après le schéma principal, exécutez-les également dans Supabase avant le redéploiement.

### 3. Configurer Supabase Auth

Vérifiez que la connexion par courriel et mot de passe est activée.

Configurez aussi :

- l’URL du site avec votre domaine Vercel;
- les URL de redirection autorisées pour le domaine de production et les domaines Preview utilisés.

La confirmation de courriel peut rester activée. Dans ce cas, l’utilisateur confirme d’abord son courriel, puis se connecte; son compte demeure en attente d’approbation dans l’application.

### 4. Variables Vercel

Variables principales :

```text
SUPABASE_URL=https://VOTRE-PROJET.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
OPENAI_API_KEY=...
OPENAI_VISION_MODEL=gpt-5-nano
```

Pour le premier administrateur, utilisez l’une des méthodes suivantes.

#### Méthode recommandée

```text
BOOTSTRAP_ADMIN_EMAIL=admin@votre-magasin.ca
```

Le compte inscrit avec ce courriel est automatiquement approuvé comme administrateur lors de sa première connexion.

#### Méthode de secours

```text
APP_PIN=un-long-code-d-installation
```

Lorsqu’aucun administrateur n’existe, le premier utilisateur connecté en attente peut entrer ce code. Dès qu’un administrateur existe, cette promotion initiale est bloquée.

### 5. Redéployer

Après une modification de schéma ou de variables, redéployez l’application dans Vercel.

Si une ancienne interface demeure en cache, fermez complètement la PWA puis rouvrez-la. Au besoin, retirez et réinstallez la PWA ou videz les données du site.

## Approbation des utilisateurs

1. L’utilisateur ouvre la page d’inscription.
2. Il entre son nom, son courriel et son mot de passe.
3. Son profil est créé avec l’état `pending`.
4. Après connexion, l’application indique que la demande est en attente.
5. Un superviseur ou administrateur ouvre **Plus → Utilisateurs**.
6. Il approuve ou refuse la demande.
7. L’utilisateur vérifie l’approbation ou se reconnecte.

## Architecture

- Interface PWA : HTML, CSS et JavaScript côté client.
- Authentification : Supabase Auth.
- Profils et rôles : `public.profiles`.
- État collaboratif principal : `public.app_state`.
- Photos privées : bucket `stock-location-photos`.
- API serveur : fonctions Vercel dans `api/`.
- Module Événements : interface dédiée et logique serveur reliée aux comptes Supabase.
- Analyse d’étiquettes : API OpenAI appelée côté serveur.
- Rapports : génération PDF côté serveur.

Les clés secrètes Supabase et OpenAI ne sont jamais envoyées au navigateur. Les fonctions Vercel valident le jeton Supabase Auth avant d’accéder aux données et appliquent les restrictions selon le rôle.

## Développement local

Prérequis : **Node.js 20 ou plus récent**.

```bash
npm install
vercel dev
```

Créez un fichier `.env.local` à partir de `.env.example` et renseignez les variables nécessaires.

## Limites actuelles

- L’état opérationnel principal demeure un document JSON partagé dans `app_state`; cette architecture convient à un MVP ou à un magasin de taille modérée.
- Pour un très grand volume ou de nombreuses modifications simultanées, une migration vers des tables relationnelles distinctes pour les articles, listes et historiques serait recommandée.
- Les permis enregistrés constituent une vérification administrative interne et ne remplacent pas les exigences de formation, d’autorisation et de sécurité de l’employeur.

---

Projet : [nathanbegin/GestionStockHD](https://github.com/nathanbegin/GestionStockHD)
