# 🔐 Simkl API Setup Guide for Zoro Plugin

To login, you'll need to create your own **Client ID** and **Client Secret** from Simkl. It only takes a minute—just follow these steps.

---

## 📌 Step-by-Step Instructions

1. **Go to the Simkl Developer Page**  
   👉 [https://simkl.com/settings/developer/new/](https://simkl.com/settings/developer/new/)

2. **Fill in the fields as follows:**

   - **App Name**:  
     ```
      Zoro
     ```

   - **Description**:  
     ```
     Obsidian plugin for managing anime and manga lists
     ```

   - **Redirect URI**:  
     ```
     urn:ietf:wg:oauth:2.0:oob
     ```

   > ⚠️ **Important**: Make sure the Redirect URI is exactly `urn:ietf:wg:oauth:2.0:oob` or authentication will fail.

3. Click **Save**.

4. After saving, you will see your **Client ID**, **Client Secret**, and **Redirect URI**.  
   → Copy down the **Client ID** and **Client Secret**.

---

# 🔐 How to Authenticate with Simkl

Follow these steps to link your Simkl account with Zoro:

1. **Create an app on Simkl** and copy your:
   - **Client ID**
   - **Client Secret**

2. **Open the Zoro plugin settings** in Obsidian.

3. Click the **"Enter Client ID"** button.  
   → Paste your **Client ID** and confirm.

4. The button will now change to **"Enter Client Secret"**.  
   → Paste your **Client Secret** and confirm.

5. The button will now say **"Authenticate"**.  
   → Click it.

6. You will be redirected to Simkl’s website.  
   → Log in (if needed) and **authorize** the app.

7. After about **3 seconds**, you will be redirected back to **simkl.com**.

8. Return to the Zoro plugin settings in Obsidian.  
   → You’ll now see a ✅ **"Authenticated"** message confirming the connection.

---

✅ That’s it! Your Simkl account is now securely connected to **Zoro**.
