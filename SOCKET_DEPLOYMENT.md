# Socket Server Deployment Guide

## Quick Deployment to Render

### Step 1: Deploy Socket Server to Render

1. **Go to [Render.com](https://render.com) and sign up/login**

2. **Create a New Web Service:**
   - Click "New +" → "Web Service"
   - Connect your GitHub repository
   - Select the repository containing your project

3. **Configure the Service:**
   - **Name**: `gunifriends-socket-server` (or any name you prefer)
   - **Root Directory**: `socket-server`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`

4. **Add Environment Variables:**
   In the Render dashboard, add these environment variables:
   ```
   JWT_SECRET=your-super-secret-jwt-key-change-in-production-make-it-long-and-random
   MONGODB_URI=mongodb+srv://pariharmadhukar77_db_user:KINuusRGZT4uSZWr@cluster0.5l2abr1.mongodb.net/?appName=Cluster0
   DATABASE_NAME=university_video_chat
   CORS_ORIGINS=http://localhost:3000,https://gunifriends.vercel.app
   ```

5. **Deploy:**
   - Click "Create Web Service"
   - Wait for deployment to complete
   - Note the URL (e.g., `https://gunifriends-socket-server.onrender.com`)

### Step 2: Update Vercel Environment Variables

1. **Go to your Vercel dashboard**
2. **Select your project (gunifriends)**
3. **Go to Settings → Environment Variables**
4. **Add/Update:**
   ```
   NEXT_PUBLIC_SOCKET_URL=https://your-render-app-name.onrender.com
   ```
   Replace `your-render-app-name` with your actual Render app name.

5. **Redeploy your Vercel app** to pick up the new environment variable

### Step 3: Test the Connection

1. **Visit your Vercel app**: `https://gunifriends.vercel.app`
2. **Try to register/login**
3. **Check if Socket.io connection works** (you should see connection status in the UI)

## Troubleshooting

### If registration still fails:
- Check Vercel function logs for database connection errors
- Verify MongoDB URI is correct in Vercel environment variables
- Ensure all required environment variables are set

### If Socket.io connection fails:
- Check Render logs for the socket server
- Verify CORS_ORIGINS includes your Vercel domain
- Ensure NEXT_PUBLIC_SOCKET_URL is correctly set in Vercel

### Common Issues:
1. **MongoDB Connection**: Make sure the MongoDB URI is exactly the same in both Vercel and Render
2. **JWT Secret**: Must be identical in both applications
3. **CORS**: Render app must allow your Vercel domain in CORS_ORIGINS

## Current Status

✅ **Fixed Issues:**
- TypeScript compilation error in registration route
- Socket.io connection logic updated for production
- Environment variables configured for both local and production

🔄 **Next Steps:**
1. Deploy socket server to Render
2. Update NEXT_PUBLIC_SOCKET_URL in Vercel with Render URL
3. Test end-to-end functionality

## Environment Variables Summary

### Vercel (.env.production):
```
NEXT_PUBLIC_BASE_URL=https://gunifriends.vercel.app
NEXT_PUBLIC_SOCKET_URL=https://your-render-app.onrender.com
MONGODB_URI=mongodb+srv://pariharmadhukar77_db_user:KINuusRGZT4uSZWr@cluster0.5l2abr1.mongodb.net/?appName=Cluster0
DATABASE_NAME=university_video_chat
JWT_SECRET=your-super-secret-jwt-key-change-in-production-make-it-long-and-random
```

### Render (Socket Server):
```
JWT_SECRET=your-super-secret-jwt-key-change-in-production-make-it-long-and-random
MONGODB_URI=mongodb+srv://pariharmadhukar77_db_user:KINuusRGZT4uSZWr@cluster0.5l2abr1.mongodb.net/?appName=Cluster0
DATABASE_NAME=university_video_chat
CORS_ORIGINS=http://localhost:3000,https://gunifriends.vercel.app
```