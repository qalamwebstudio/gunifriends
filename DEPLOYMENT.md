# Deployment Guide

## Vercel Deployment

### Environment Variables Required:

Add these environment variables in Vercel Dashboard → Settings → Environment Variables:

```
NEXT_PUBLIC_BASE_URL = https://gunifriends.vercel.app
FRONTEND_URL = https://gunifriends.vercel.app
NODE_ENV = production
JWT_SECRET = your-super-secret-jwt-key-change-in-production-make-it-long-and-random
SMTP_HOST = smtp.gmail.com
SMTP_PORT = 587
SMTP_USER = pariharmadhukar32@gmail.com
SMTP_PASS = kkcw kvgc ggst zyqu
SEND_EMAILS = true
MONGODB_URI = mongodb+srv://pariharmadhukar77_db_user:KINuusRGZT4uSZWr@cluster0.5l2abr1.mongodb.net/?appName=Cluster0
DATABASE_NAME = university_video_chat
```

### Steps:

1. Push your code to GitHub
2. Connect GitHub repo to Vercel
3. Add environment variables in Vercel dashboard
4. Deploy

### Important Notes:

- Socket.io connections now use dynamic URLs based on environment
- All API calls will work with the deployed URL
- Email verification links will use the production URL

### Local Development:

For local development, use `.env.local` with localhost URLs:

```
NEXT_PUBLIC_BASE_URL=http://localhost:3000
NODE_ENV=development
```