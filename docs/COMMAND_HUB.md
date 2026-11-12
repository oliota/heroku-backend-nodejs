# Backend Desktop Command Hub

- `apply-command-hub.cmd`: safely merge command scripts into the existing package.json.
- `open-command-hub.cmd` or `npm run hub`: open the Windows desktop window.
- **Start / Development**: start one managed local server on port 3002; **Stop** kills its process tree.
- **Tests / Build / Lint**: independent tasks with visible progress and output.
- **Login**: opens an interactive CMD window for Heroku or Firebase authentication.
- **Publish all**: prompt for a commit message, confirm, test, build, push to `origin`, then `heroku-backend-nodejs`.
- **Health**: check local or deployed API responses.
- **Cancel**: stop an active task, not the managed server.

The window intentionally will not terminate another process already bound to port 3002. Use the owner PID shown in the warning if you need to stop an external server manually. `npm run help` lists the terminal alternatives.
