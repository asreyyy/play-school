# Launch Guide: putting your clinic app online

This guide is for people with no technical experience. Follow the steps in order, and each one tells you exactly what to click.

The app itself is already finished and tested. What's left are the steps that need **your** accounts, payments and decisions, which nobody else can do for you.

**Time needed:** about 1–2 hours, plus waiting for a web address to start working (up to a day).

---

## What you will need

| Thing | Why | Cost (approximate, check current prices) |
|---|---|---|
| **GitHub account** (you have one) | Stores the app's code. The hosting service reads it from here. | Free |
| **Render account** ([render.com](https://render.com)) | Runs the app on the internet 24/7. | Starter plan, about US $7/month, plus about $0.25/month for the 1 GB disk. See [render.com/pricing](https://render.com/pricing). |
| **A debit/credit card** | Render needs one for the paid plan. | — |
| **A web address (domain)**, optional but recommended | So patients visit `yourclinic.in` instead of `clinic-abc.onrender.com`. | About ₹800–1,500 per year from GoDaddy, Hostinger, Namecheap, Google/Squarespace Domains, etc. |

> **Why paid hosting?** The app saves appointments and patient records in a file on the server's disk. Free hosting plans wipe the disk regularly, so you would lose data. The Starter plan keeps a permanent disk.

---

## Step 1: Give Claude access to your GitHub repository

The code is ready, but Claude couldn't upload ("push") it to your GitHub because access was refused.

1. Go to **https://claude.ai/connect-github** and connect (or reconnect) your GitHub account.
2. If it asks you to install the **Claude GitHub App**, install it and choose the `play-school` repository.
3. Come back to the chat and say **"access fixed, please push"**.

✅ **Done when:** Claude confirms the code has been pushed.

## Step 2: Move the code to the main branch

The code is on a separate "branch" (a draft copy) called `claude/clinic-booking-management-app-5hpg0e`. Render will use your **main** branch, so the code needs to be merged into it.

The easiest way: ask Claude **"open a pull request and tell me how to merge it"**. Or do it yourself:

1. Open your repository on github.com.
2. You'll see a yellow banner, "*claude/clinic-… had recent pushes*". Click **Compare & pull request**.
3. Click **Create pull request**, then **Merge pull request**, then **Confirm merge**.

✅ **Done when:** you can see a `clinic` folder and a `render.yaml` file on the main page of your repository.

## Step 3: Create your Render account

1. Go to [render.com](https://render.com) and click **Get Started**.
2. Choose **Sign up with GitHub**. This links the two accounts.
3. Add your card under **Billing** when asked.

## Step 4: Create the app on Render (one-time)

The repository includes a file (`render.yaml`) that tells Render exactly how to set everything up, so you only fill in two things.

1. In Render, click **New +**, then **Blueprint**.
2. Pick your `play-school` repository. (If you don't see it, click **Configure GitHub** and give Render access to it.)
3. Render shows a service called **clinic** and asks for two values:
   - **ADMIN_EMAIL**: the email you'll use to sign in as admin (e.g. your own email).
   - **ADMIN_PASSWORD**: a strong password, at least 12 characters. **Write it down somewhere safe.**
4. Click **Apply** (or **Deploy Blueprint**).
5. Wait 5–10 minutes. Render builds and starts the app. When the status says **Live** (green), it's running.
6. Near the top of the service page you'll see a link like `https://clinic-xxxx.onrender.com`. **That's your clinic website!**

> The timezone is set to India (`Asia/Kolkata`) and the server region to Singapore (closest to India). If your clinic is elsewhere, tell Claude and it will change these.

✅ **Done when:** opening the link shows your booking page.

## Step 5: Set up the clinic (in the app)

Open `https://<your-link>/staff` and sign in with the ADMIN_EMAIL and ADMIN_PASSWORD from Step 4. Then work through this checklist:

- [ ] **Clinic Settings**: clinic name, tagline, phone, email, address and currency. These show on the patient website.
- [ ] **Clinic Settings → Online booking**: decide whether online bookings need your confirmation (recommended at first) or are confirmed automatically.
- [ ] **Doctors**: click **Edit** on each of the three placeholder doctors ("Dr. Doctor 1/2/3") and enter:
  - their real name, title, qualifications and a short bio (patients see these);
  - their **real email** and a **temporary password**. Give each doctor their email and temporary password privately. They'll be asked to choose their own password the first time they sign in.
- [ ] **Working Hours**: choose each doctor from the dropdown and set their real weekly hours. Add leave days when needed.
- [ ] **Services & Fees**: rename or adjust the services, durations and fees, or add new ones.
- [ ] **Staff Accounts**: if you have a receptionist, add them here (role: Receptionist).

## Step 6: Review the privacy policy

Your website has a privacy policy at `https://<your-link>/privacy`. Patients must agree to it before booking.

It's a **starting template**. Some parts are in [square brackets] and must be filled in, such as how many years you keep records. Because you handle mental-health information:

- Read it carefully and, ideally, have a lawyer check it.
- If you're in India, the relevant rules include the **Digital Personal Data Protection Act, 2023**, the **Mental Healthcare Act, 2017** (confidentiality), and the **Telemedicine Practice Guidelines** if you offer online consultations.
- Send Claude the final text or the missing details, and it will update the page for you.

## Step 7: Test everything before telling patients

Do a complete practice run:

- [ ] On your phone, open the website and **book an appointment** as if you were a patient.
- [ ] Sign in to `/staff` and check it appears under **Awaiting confirmation**. Click ✔ to confirm it.
- [ ] Sign in as one of the doctors (in a private/incognito window) and check they see only their own appointments.
- [ ] As the doctor, open the patient and **write a session note**.
- [ ] Back on the website, use **Manage My Booking** with the reference and phone number to **cancel** the test booking.
- [ ] In **Clinic Settings**, click **Download backup** and check a file downloads.

If anything looks wrong, describe it to Claude (a screenshot helps).

## Step 8: Use your own web address (optional, recommended)

1. Buy a domain from a registrar (GoDaddy, Hostinger, Namecheap…), for example `mindcareclinic.in`.
2. In Render, open your **clinic** service, go to **Settings**, then **Custom Domains**, then **Add Custom Domain**. Type your domain (e.g. `www.mindcareclinic.in`) and save.
3. Render shows you one or two **DNS records** (a type such as `CNAME` and a value such as `clinic-xxxx.onrender.com`).
4. In your registrar's website, find **DNS settings** / **Manage DNS** for the domain and add exactly those records.
5. Wait. It usually starts working within an hour, but can take up to a day. Render sets up the padlock (HTTPS) automatically.

✅ **Done when:** `https://www.yourdomain` opens your booking page with a padlock in the address bar.

## Step 9: Launch! 🎉

Share your booking link:
- On your **Google Business Profile** (add it as the "Appointment link"). This is very effective.
- In your WhatsApp Business profile, Instagram bio, visiting cards and clinic signboard (a QR code works well).

---

## Your routine after launch

| How often | What to do |
|---|---|
| **Every morning** | Open the Dashboard. Confirm or decline bookings under *Awaiting confirmation*. Check today's schedule. |
| **After each appointment** | Mark it *Completed* (or *No-show*) and record the payment as *Paid*. |
| **When a doctor takes leave** | Add it under *Working Hours → Leave* so patients can't book those days. |
| **Every week** | Clinic Settings, then **Download backup**. Store the file somewhere private and safe, such as an encrypted drive. It contains patient records, so never email it or share it. |
| **Every month** | Look at **Reports**: appointments, no-shows and money collected/outstanding. |

**Automatic safety nets:** the app saves its own backup every day and keeps the last 14 days. Render also takes daily snapshots of the disk.

**Online consultations:** the app records that a booking is "online", but it doesn't create video calls. Send the patient a Google Meet / Zoom / WhatsApp video link yourself.

## If something goes wrong

- **The website doesn't open:** in Render, open the **clinic** service and look at the status. Click **Logs** to see messages and **Manual Deploy → Restart** to restart it. Send Claude a screenshot of the logs.
- **Someone forgot their password:** an admin can set a new temporary password (Doctors → Edit, or Staff Accounts). The person will be asked to change it when they sign in.
- **You forgot the admin password:** if there's a second admin, they can reset it. Otherwise ask Claude or a developer for help.
- **Data needs restoring from a backup:** don't experiment. Ask Claude or a developer, and keep your backup files safe.

## Changing the app later

Every time new code is merged into the main branch on GitHub, Render automatically updates the website within a few minutes. Your data stays safe on the disk.

Ideas for later (ask Claude any time):
- SMS / WhatsApp / email appointment reminders (needs an account with a messaging provider)
- Online payment at booking (e.g. Razorpay)
- Printable prescriptions or invoices
