# ChoopaNature

Plateforme de démonstration pour vendre des photos de nature.

## Fonctionnalités incluses

- Accueil noir responsive
- Recherche et catégories
- Inscription / connexion
- Rôles acheteur et photographe
- Upload JPEG/PNG/WEBP jusqu'à 10 Mo
- Galerie stockée en SQLite
- Prix par photo
- Achats associés au compte
- Espace utilisateur
- Sessions sécurisées côté serveur
- Structure prête pour brancher un vrai prestataire de paiement

## Lancer le site

1. Installer Node.js 20+.
2. Dans le dossier du projet :

```bash
npm install
npm start
```

3. Ouvrir http://localhost:3000

## Paiement réel

La route `/api/purchases` est volontairement un mode démonstration. Pour vendre réellement, il faut intégrer un prestataire de paiement, vérifier le paiement côté serveur, puis créer l'achat seulement après confirmation du prestataire.

## Production

À ajouter avant mise en ligne : HTTPS, secret de session dans une variable d'environnement, stockage objet (S3/Cloudflare R2/etc.), protection CSRF/rate limiting, modération des images, politique de licence, système de remboursement, emails et vraie passerelle de paiement.
