# Sécurité et mise en production

## Mesures présentes

- `APP_PIN` est comparé côté Vercel.
- `SUPABASE_SECRET_KEY` et `OPENAI_API_KEY` restent uniquement côté serveur.
- Le navigateur reçoit seulement `SUPABASE_PUBLISHABLE_KEY`, conçue pour être publique.
- Les événements Realtime ne contiennent pas le contenu des listes; ils indiquent seulement qu’une actualisation est disponible.
- La table `app_state` n’accorde aucun accès direct aux rôles `anon` ou `authenticated`.
- Le bucket `stock-location-photos` est privé.
- Les photos sont validées, compressées et limitées à 3 Mo.
- Les photos sont affichées avec des liens signés temporaires.
- Les chemins Storage sont validés avant lecture ou suppression.

## Avant un usage réel à grande échelle

Remplacez le PIN partagé par une authentification individuelle et ajoutez :

- rôles employé, gestionnaire et administrateur;
- séparation par magasin;
- journal d’audit;
- politiques de conservation des photos;
- validation officielle des permis et autorisations;
- limites de fréquence;
- suivi des erreurs et des coûts;
- révocation des sessions et des appareils.

Ne commitez jamais un fichier `.env` réel ni les clés secrètes.
