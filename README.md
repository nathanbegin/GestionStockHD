# Remplissage magasin V4 — PWA Vercel + Supabase

## Version 4.1 — navigation par balayage

Dans l’écran de ramassage / mode remplissage :

- balayage vers la gauche : article suivant;
- balayage vers la droite : article précédent;
- les boutons **Précédent** et **Suivant** demeurent disponibles;
- le défilement vertical de la page reste fonctionnel;
- un balayage commencé sur un bouton ou un champ ne déclenche pas la navigation.

Aucune modification de la base Supabase n’est requise pour cette mise à jour. Le cache PWA passe à `remplissage-v4-1`; fermez puis rouvrez l’application après le déploiement.


Application mobile de réapprovisionnement permettant de relever les produits manquants, d’assigner le travail et de partager les changements entre plusieurs appareils.

## Nouveautés de la V4

- envoi automatique au cloud après chaque ajout, modification, changement de statut ou suppression;
- réception rapide des changements sur les autres appareils avec Supabase Realtime Broadcast;
- vérification périodique toutes les 15 secondes comme solution de repli;
- conservation locale hors ligne et nouvel essai automatique au retour du réseau;
- gestion des employés;
- attribution d’un article à un ou plusieurs employés;
- déclaration du permis de chariot élévateur, numéro et date d’expiration;
- avertissement et validation lorsqu’un article exige un lift;
- photo de l’emplacement d’entreposage;
- stockage privé des photos dans Supabase Storage;
- affichage des photos avec des liens signés temporaires;
- filtre « Mes articles » et filtre par employé.

Les fonctions des versions précédentes demeurent présentes : lecture d’étiquette, ajout manuel, SKU `1000` ou `1001`, affichage `1001 123 456`, listes, départements, sélection multiple, mode remplissage, export et PWA.

## Mise à jour depuis la V3

### 1. Remplacer les fichiers du dépôt

Décompressez cette version et remplacez le contenu du dépôt Git relié à Vercel.

### 2. Réexécuter le SQL

Dans **Supabase → SQL Editor**, exécutez de nouveau :

```text
supabase/schema.sql
```

Le script est idempotent. Il conserve les données existantes et crée le bucket privé `stock-location-photos`.

### 3. Ajouter la clé publique Supabase dans Vercel

Dans **Vercel → Settings → Environment Variables**, conservez les variables existantes et ajoutez :

```text
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

La clé se trouve dans **Supabase → Settings → API Keys**. Utilisez la clé `Publishable`, et non la clé secrète.

Variables complètes :

```text
APP_PIN=...
OPENAI_API_KEY=...
OPENAI_VISION_MODEL=gpt-5-nano
SUPABASE_URL=https://VOTRE-PROJET.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Mettez uniquement la valeur dans chaque champ Vercel, sans répéter le nom de la variable.

### 4. Redéployer

Après les variables, lancez un nouveau déploiement Vercel. Fermez ensuite complètement la PWA et rouvrez-la afin de charger le service worker `remplissage-v4-1`.

## Fonctionnement de la synchronisation

1. Une modification est enregistrée immédiatement dans le navigateur.
2. Après environ 700 ms, l’application appelle `/api/sync`.
3. La fonction Vercel fusionne la copie locale et la copie Supabase.
4. Après réussite, le client envoie un événement Realtime sans données sensibles.
5. Les autres clients reçoivent l’événement et récupèrent la nouvelle copie par `/api/sync` avec leur PIN.
6. Si Realtime n’est pas configuré, une vérification périodique garde tout de même les clients à jour.

Le bouton **Synchroniser maintenant** reste disponible pour forcer une opération.

## Employés et permis de lift

Dans **Réglages → Employés et permis de lift** :

- ajoutez le nom de l’employé;
- indiquez s’il possède un permis;
- ajoutez facultativement le numéro et la date d’expiration;
- modifiez l’employé lorsque son statut change.

Un article peut être assigné à plusieurs employés. Lorsqu’il nécessite un chariot élévateur et que des employés sont assignés, l’application exige qu’au moins une personne ait un permis déclaré valide. Une fiche non assignée peut être créée, mais elle affiche alors un avertissement « permis requis ».

Cette vérification est un aide-mémoire administratif. Elle ne remplace pas la validation officielle de la formation, de l’autorisation de l’employeur et des règles de sécurité applicables.

## Photos d’emplacement

Les photos d’emplacement sont :

- compressées sur le téléphone;
- limitées à 3 Mo côté serveur;
- envoyées par `/api/photo-upload`;
- conservées dans un bucket privé Supabase;
- ouvertes au moyen d’un lien signé d’une heure obtenu par `/api/photo-url`.

La clé secrète Supabase n’est jamais exposée au navigateur.

## Développement local

```bash
npm install
vercel dev
```

## Structure principale

```text
api/analyze.js             Analyse d’étiquette
api/sync.js                Fusion et synchronisation cloud
api/realtime-config.js     Configuration publique Realtime après validation du PIN
api/photo-upload.js        Téléversement privé des photos
api/photo-url.js           Création des liens signés
api/photo-delete.js        Suppression des photos
lib/supabase-admin.js      Client Supabase côté serveur
supabase/schema.sql        Table et bucket Storage
app.js                     Interface et synchronisation automatique
styles.css                 Interface mobile
sw.js                      PWA hors ligne
```

## Limites du MVP

- le PIN demeure partagé entre les employés;
- l’application utilise une seule copie de magasin identifiée par `default`;
- les permis sont déclarés manuellement;
- Realtime utilise un canal Broadcast public dont le nom est remis seulement après validation du PIN; les données elles-mêmes restent protégées derrière les fonctions Vercel;
- pour plusieurs magasins ou des exigences d’audit, il faudra ajouter une authentification individuelle et des rôles.
