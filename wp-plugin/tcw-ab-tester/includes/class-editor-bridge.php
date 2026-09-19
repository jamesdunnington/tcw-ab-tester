<?php
/**
 * Bridge between the hub's visual editor / heatmap overlay and a live WordPress
 * page (docs/PLAN.md section 7).
 *
 * The hub opens https://site/page?tcwab_editor=TOKEN (visual editor) or
 * https://site/page?tcwab_heatmap=TOKEN (read-only heatmap). Each token has its
 * own kind and only opens its own overlay. We only load an overlay when BOTH hold:
 *   1. the token is a valid, unexpired hub-signed token for this site, and
 *   2. the visitor is a logged-in WordPress user who can edit_pages.
 * The token alone is never enough: it proves the hub sent someone here, not
 * that they may edit this site.
 *
 * Editor requests are also kept out of caches and out of the A/B split, so
 * the editor always sees the original page.
 */

if (!defined('ABSPATH')) {
	exit;
}

class TCWAB_Editor_Bridge {

	private const QUERY_ARG   = 'tcwab_editor';
	private const HEATMAP_ARG = 'tcwab_heatmap';

	private TCWAB_Hub_Client $hub_client;

	/** @var array{sk:string,t:string,v:string,exp:int,n:string}|null */
	private ?array $grant = null;

	/** Which query arg carried the accepted token: 'editor' or 'heatmap'. */
	private string $mode = 'editor';

	public function __construct(TCWAB_Hub_Client $hub_client) {
		$this->hub_client = $hub_client;
	}

	/**
	 * Cheap check used by TCWAB_Runtime to skip the A/B snippet. Deliberately
	 * does not verify the token: skipping the split for a bogus request is harmless.
	 */
	public static function is_editor_request(): bool {
		return isset($_GET[self::QUERY_ARG]) || isset($_GET[self::HEATMAP_ARG]); // phpcs:ignore WordPress.Security.NonceVerification -- token is verified in gate()
	}

	/** Query arg and token kind of this request: the heatmap arg wins only when the editor arg is absent. */
	private static function current_arg(): string {
		return isset($_GET[self::QUERY_ARG]) ? self::QUERY_ARG : self::HEATMAP_ARG; // phpcs:ignore WordPress.Security.NonceVerification
	}

	/** Hooked on template_redirect (early): authorises the request or stops it. */
	public function gate(): void {
		if (!self::is_editor_request()) {
			return;
		}

		// Never let a cache store or serve an editor page.
		if (!defined('DONOTCACHEPAGE')) {
			define('DONOTCACHEPAGE', true);
		}
		nocache_headers();
		header('X-Robots-Tag: noindex, nofollow');

		$arg        = self::current_arg();
		$this->mode = self::HEATMAP_ARG === $arg ? 'heatmap' : 'editor';
		$token      = sanitize_text_field(wp_unslash((string) $_GET[$arg])); // phpcs:ignore WordPress.Security.NonceVerification
		$grant      = $this->hub_client->verify_editor_token($token, $this->mode);
		if (null === $grant) {
			wp_die(esc_html__('This link is invalid or has expired. Open it again from the TCW hub.', 'tcw-ab-tester'), '', ['response' => 403]);
		}

		if (!is_user_logged_in()) {
			// After logging in WordPress sends them back here; the token lives 5 minutes.
			// Rebuilt from the permalink, not the request URI, so subfolder installs do not double the path.
			$back = is_singular() ? get_permalink() : home_url('/');
			wp_safe_redirect(wp_login_url(add_query_arg($arg, rawurlencode($token), $back)));
			exit;
		}
		if (!current_user_can('edit_pages')) {
			wp_die(esc_html__('You do not have permission to edit pages on this site.', 'tcw-ab-tester'), '', ['response' => 403]);
		}

		$this->grant = $grant;
		add_action('wp_footer', [$this, 'print_overlay'], 100);
	}

	/** Prints the overlay's boot config and loads editor.js or heatmap.js from the hub. */
	public function print_overlay(): void {
		if (null === $this->grant) {
			return;
		}
		$heatmap = 'heatmap' === $this->mode;
		$hub_url = $this->hub_client->get_hub_url();
		$boot    = [
			'hubUrl'     => $hub_url,
			'siteKey'    => $this->hub_client->get_site_key(),
			'testId'     => (string) $this->grant['t'],
			'variantKey' => (string) $this->grant['v'],
			'token'      => sanitize_text_field(wp_unslash((string) $_GET[self::current_arg()])), // phpcs:ignore WordPress.Security.NonceVerification
			'expiresAt'  => (int) $this->grant['exp'],
		];

		// JSON_HEX_* keep the payload from ever closing the script tag.
		$global = $heatmap ? '__TCWAB_HEATMAP__' : '__TCWAB_EDITOR__';
		$bundle = $heatmap ? '/heatmap.js' : '/editor.js';
		echo '<script>window.' . $global . '=' . wp_json_encode($boot, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . ";</script>\n"; // phpcs:ignore WordPress.Security.EscapeOutput
		echo '<script src="' . esc_url($hub_url . $bundle) . '" defer></script>' . "\n";
	}
}
