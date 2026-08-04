# Sécurité

- Ne jamais commiter `.env` ni les clés réelles.
- Les secrets OpenAI et Supabase restent dans les fonctions Vercel.
- Le PIN est comparé avec `timingSafeEqual`.
- Les images sont compressées et leur taille est limitée.
- Supabase RLS est activé et aucun accès public n’est accordé.
- Avant un déploiement à grande échelle, ajouter des comptes individuels, des rôles, un journal d’audit, des limites de fréquence et une politique de conservation des photos.
