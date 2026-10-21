# Publishing on GitHub — a first-timer's guide

This explains how to put the project on GitHub so that people can (a) read and download the source and
(b) download the ready-made portable `.exe`. You need no command line. Everything is free.

## 0. Before you start (5 minutes)

- Open `LICENSE` and replace `Kurator Session Manager contributors` with your name or handle if you want
  your name on it.
- Check `package.json`: `"version"` is the version number people see in the exe's file name.
- Your **own campaigns are safe**: the file `.gitignore` tells GitHub Desktop to never upload
  `campaign-data/` (your real campaigns), `settings.json` (your paths) or `node_modules/`.

## 1. Create your GitHub account

1. Go to <https://github.com> and sign up. The username is public — choose one you are happy to be known by.
2. Hide your email: **Settings → Emails →** tick *Keep my email addresses private* and *Block command line
   pushes that expose my email*. (Otherwise the email you sign up with could show up in your commits.)

## 2. Install GitHub Desktop (a free app with buttons instead of commands)

1. Download it from <https://desktop.github.com>, install and sign in with your new account.
2. In GitHub Desktop choose **File → Add local repository…** and pick your Kurator project folder (the one
   that contains `package.json`).
3. It will say "this directory does not appear to be a Git repository" — click **create a repository**
   and confirm. In the list of changed files you should see `src`, `renderer`, `README.md`, … and
   **not** `campaign-data` or `settings.json`. If you do see those, stop and ask for help.
4. Write a first commit message at the bottom left, for example `First version`, and click
   **Commit to main**.
5. Click **Publish repository** at the top. Name it (for example `kurator-session-manager`), add a short
   description, and **untick** *Keep this code private* so people can see it. Publish.

You now have a public project at `https://github.com/<your-name>/kurator-session-manager`.

## 3. Make the project page nice

On the project page click the small gear next to **About** and add a one-line description and a few topics
(`dnd`, `dungeons-and-dragons`, `dm-tools`, `electron`, `ttrpg`). The README you wrote is shown
automatically below the file list.

## 4. Publish the first release (this builds the .exe for you)

1. On the project page click **Releases → Create a new release** (right sidebar).
2. **Choose a tag**, type `v1.0.0` and select *Create new tag*.
3. Give it a title (`Kurator Session Manager 1.0.0`) and describe what is in it.
4. Click **Publish release**.
5. Open the **Actions** tab. A workflow called *Build portable Windows app* starts. After about 5–10
   minutes it turns green, and the `.exe` appears at the bottom of your release under **Assets**.
   (Red? Click it and read the log. The usual cause is a test that failed.)
6. Download the exe from the release and try it on a computer that has no Node.js — that is exactly what your
   users will do. The first start creates the example campaign next to the exe.

If the workflow says it is not allowed to write to the release: **Settings → Actions → General →
Workflow permissions → Read and write permissions**, save, then run the workflow again from the Actions tab
(*Run workflow*).

## 5. Publishing an update later

1. Work on your home PC exactly as before. The project folder *is* your repository.
2. When you have a version you want to share: raise `"version"` in `package.json` (for example `1.1.0`),
   open GitHub Desktop, check the list of changes, write a commit message, **Commit to main**, then
   **Push origin**.
3. On GitHub create a new release with the tag `v1.1.0`. The exe is built again automatically.

A new zip from Claude replaces the files in your project folder as usual; GitHub Desktop then shows exactly
what changed, which makes it easy to check before committing.

## 6. Things that will happen

- **Windows SmartScreen** warns about the exe because it is not code-signed (signing certificates cost money).
  The README already tells people to click *More info → Run anyway*.
- People may report bugs under the **Issues** tab. You can switch Issues off in *Settings → Features* if you
  don't want that.
- Users keep their campaigns in the `campaign-data` folder next to the exe. A new exe version can simply be
  placed in the same folder and their data stays.
