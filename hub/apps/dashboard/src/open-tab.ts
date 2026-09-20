/**
 * Opens a WordPress page in its own tab and never navigates the tab the hub runs in.
 *
 * The URL (a signed editor or heatmap link) only exists after a request to the hub. A window opened
 * after an await can be stopped by a pop-up blocker, so the tab is opened straight away, inside the
 * click, and sent to the URL once it arrives. The opener link is cut before it navigates, because
 * the WordPress site is a different origin and must not be able to reach back into the hub tab.
 */
export async function openInNewTab(getUrl: () => Promise<string>): Promise<void> {
  const tab = window.open("", "_blank");
  if (!tab) {
    throw new Error("your browser blocked the new tab. Allow pop-ups for this page and try again");
  }
  try {
    tab.document.title = "Opening…";
    const url = await getUrl();
    tab.opener = null;
    tab.location.replace(url);
  } catch (err) {
    tab.close();
    throw err;
  }
}
