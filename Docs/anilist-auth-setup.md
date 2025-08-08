# 🔐 AniList API Setup Guide for Zoro Plugin

To login , you'll need to create your own **Client ID** and **Client Secret** from AniList. It's quick and easy—just follow these simple steps.

---

## 📌 Step-by-Step Instructions

1. **Go to the AniList Developer Page**  
   👉 [https://anilist.co/settings/developer](https://anilist.co/settings/developer)

2. **Click “Create New Client”** at the top.

3. **Fill in only these two fields:**

   - **App Name**:  
     ```
     Zoro
     ```

   - **Redirect URI**:  
     ```
     https://anilist.co/api/v2/oauth/pin
     ```

4. Click **Save**.

---

# 🔐 How to Authenticate with AniList

Follow these steps to link your AniList account with Zoro:

1. **Create an app on AniList** and copy your:
   - **Client ID**
   - **Client Secret**

2. **Open the Zoro plugin settings** in Obsidian.

3. Click the **"Enter Client ID"** button.  
   → Paste your **Client ID** and confirm.

4. The button will now change to **"Enter Client Secret"**.  
   → Paste your **Client Secret** and confirm.

5. The button will now say **"Authenticate"**.  
   → Click it.

6. You will be redirected to AniList.  
   → Log in (if needed) and **authorize** the app.

7. AniList will show you a **PIN code**.  
   → Copy the PIN.

8. Go back to Obsidian.  
   → A prompt will appear — **paste the PIN** into it.

9. Wait a moment.  
   → You’ll see a ✅ **"Authenticated"** notification once the connection is successful.

---

✅ That’s it! Your AniList account is now securely connected to **Zoro**.
