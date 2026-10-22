# Dealer Stock Manager (Burton)

Shared stock list for **Pentagon Burton Upon Trent**, auto-synced from the public website twice a day.

## Live app
After Vercel deploy, share the Vercel URL with colleagues.

## Files
| File | Role |
|------|------|
| `index.html` | The app (list, search, stock cards, notes) |
| `vehicles.json` | Live stock data — loaded by every device |
| `sync_burton.py` | Scrapes Pentagon Burton used cars |
| `vercel.json` | Cache rules so stock is not stale |

## Daily updates
Automations run at **09:00** and **18:00** (London). After each sync, push updated `vehicles.json` to this repo and Vercel redeploys automatically.
