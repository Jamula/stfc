# Redeem history

Auto-appended log of every successful gift claim. Updated by the
`Redeem gifts` workflow on each cron run that actually claims something
(rows are not added when there's nothing new to claim). **New rows are
inserted at the top**, so the most recent run is always visible first.

> This `main` copy is a frozen seed. Live history is
> `docs/redeem-history.md` on the `automation-state` branch.

| Date (UTC) | Time (UTC) | Account | Gifts claimed |
| --- | --- | --- | --- |
