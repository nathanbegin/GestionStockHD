# Remplissage magasin — PWA pour Vercel

Application mobile de réapprovisionnement permettant de relever les produits manquants par photo d’étiquette ou saisie manuelle.

## Inclus dans cette version

- capture avec la caméra ou importation d’une photo;
- lecture de codes-barres avec l’API native du navigateur lorsqu’elle est disponible;
- analyse visuelle facultative avec OpenAI;
- confirmation du SKU avant l’ajout;
- plusieurs listes et départements;
- quantité, priorité, statut, notes et deux emplacements;
- recherche et filtres;
- mode guidé de remplissage;
- fonctionnement hors ligne avec PWA;
- sauvegarde locale automatique;
- synchronisation facultative avec Supabase;
- export CSV et JSON, ainsi qu’import JSON.

## Déploiement sur Vercel

1. Décompresser le dossier et le publier dans un dépôt GitHub.
2. Dans Vercel, choisir **Add New → Project**, puis importer le dépôt.
3. Choisir le préréglage **Other**. Il n’y a aucune commande de compilation.
4. Ajouter les variables d’environnement décrites dans `.env.example`.
5. Déployer.

## Configuration de Supabase

1. Créer un projet Supabase.
2. Ouvrir **SQL Editor**.
3. Exécuter `supabase/schema.sql`.
4. Copier l’URL du projet dans `SUPABASE_URL`.
5. Copier une clé serveur secrète dans `SUPABASE_SECRET_KEY`.

La table active RLS et n’accorde aucun accès direct au navigateur. La clé secrète est utilisée seulement par la fonction Vercel `/api/sync`.

## Configuration de l’analyse photo

Ajouter dans Vercel :

```text
OPENAI_API_KEY=...
OPENAI_VISION_MODEL=gpt-5.6
```

La photo est redimensionnée dans le navigateur avant l’envoi. La clé reste côté serveur. Le résultat doit toujours être vérifié par l’employé avant l’ajout.

## PIN

`APP_PIN` est un mot de passe partagé pour ce MVP. Utiliser une longue valeur difficile à deviner. Pour une exploitation réelle, remplacer ce PIN par une authentification individuelle avec rôles.

## Développement local

Après installation de la CLI Vercel :

```bash
vercel dev
```

## Structure

```text
api/analyze.js        Analyse sécurisée des étiquettes
api/sync.js           Synchronisation Supabase
api/health.js         Vérification de configuration
lib/auth.js           Validation du PIN
supabase/schema.sql   Table cloud
app.js                Application mobile
styles.css            Interface
sw.js                 Mode hors ligne
manifest.webmanifest  Installation PWA
```

## Limites connues du MVP

- Le PIN est partagé entre les employés.
- La synchronisation est conçue pour un seul magasin et utilise l’identifiant `default`.
- Les suppressions sont conservées comme marqueurs pour éviter qu’un article supprimé réapparaisse après synchronisation.
- Les photos sont conservées seulement si l’utilisateur coche l’option; elles occupent de l’espace dans le navigateur.
- Le catalogue officiel du magasin n’est pas encore intégré.
