/**
 * App version, surfaced in deployment telemetry: the heartbeat's `version`
 * field flows to the mothership and shows in the agency Instances fleet view
 * ("Ver" column), so you can see which published version each running
 * deployment is on.
 *
 * AUTO-BUMPED by publish.ps1 on each release (semver patch: X.Y.Z -> X.Y.Z+1),
 * which also commits the bump to main. Bump the MAJOR or MINOR by hand here
 * when a release warrants it ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â¢ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â€šÂ¬Ã…Â¡Ãƒâ€šÃ‚Â¬ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚Â the script only ever increments the patch.
 *
 * Keep the exact shape `export const APP_VERSION = "1.0.5";` on one line so the
 * publish regex can find and rewrite it.
 */
export const APP_VERSION = "1.0.5";
