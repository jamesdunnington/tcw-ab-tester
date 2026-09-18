<?php
/**
 * Injects, on every singular front-end request:
 *   1. window.__TCWAB_CONFIG__ = {...}  (a small JSON literal)
 *   2. the compiled contents of assets/runtime-inline.js, inline
 *
 * Both go out synchronously, before anything else in <head>, so a
 * page-test redirect happens before first paint (see
 * packages/tracker/src/runtime-inline.ts for why this must be inline
 * rather than an external <script src>).
 *
 * The full engagement tracker (assets/tracker.js — heartbeat, scroll,
 * hover, click) is enqueued separately, deferred, since it doesn't need
 * to block paint.
 */

if (!defined('ABSPATH')) {
	exit;
}

class TCWAB_Runtime {

	private TCWAB_Hub_Client $hub_client;

	public function __construct(TCWAB_Hub_Client $hub_client) {
		$this->hub_client = $hub_client;
	}

	public function print_head_snippet(): void {
		if (!is_singular() || !$this->hub_client->is_configured()) {
			return;
		}

		$post_id      = get_queried_object_id();
		$active_tests = $this->tests_for_post($post_id);
		if (empty($active_tests)) {
			return;
		}

		$config = [
			'ingestUrl' => $this->hub_client->get_hub_url() . '/ingest',
			'siteKey'   => $this->hub_client->get_site_key(),
			'consent'   => $this->has_tracking_consent(),
			'tests'     => $active_tests,
		];

		echo "<script>window.__TCWAB_CONFIG__=" . wp_json_encode($config) . ";</script>\n";

		$runtime_js = $this->get_runtime_inline_js();
		if ($runtime_js) {
			echo "<script>" . $runtime_js . "</script>\n"; // phpcs:ignore WordPress.Security.EscapeOutput -- pre-built, non-user-controlled bundle
		}

		wp_enqueue_script('tcwab-tracker', TCWAB_PLUGIN_URL . 'assets/tracker.js', [], TCWAB_VERSION, true);
	}

	/**
	 * @return array<int, array{testId:string, variants:array<int, array{key:string,weight:int,isControl:bool,redirectUrl?:string}>}>
	 */
	private function tests_for_post(int $post_id): array {
		$config = get_option('tcwab_runtime_config', []);
		if (!is_array($config)) {
			return [];
		}

		$matching = [];
		foreach ($config as $test) {
			if (!is_array($test) || (int) ($test['wpPostId'] ?? 0) !== $post_id) {
				continue;
			}
			if (($test['status'] ?? '') !== 'running') {
				continue;
			}
			$matching[] = [
				'testId'   => (string) $test['testId'],
				'variants' => $test['variants'] ?? [],
			];
		}
		return $matching;
	}

	/**
	 * Statistics consent gate. Integrates with the WP Consent API if a
	 * consent-management plugin (Complianz, CookieYes, etc.) provides it;
	 * defaults to "no consent" (functional-only assignment, no tracking
	 * events) if no consent plugin is active, per docs/PLAN.md section 3.
	 */
	private function has_tracking_consent(): bool {
		if (function_exists('wp_has_consent')) {
			return wp_has_consent('statistics');
		}
		return (bool) apply_filters('tcwab_default_consent', false);
	}

	private function get_runtime_inline_js(): string {
		static $cached = null;
		if (null !== $cached) {
			return $cached;
		}
		$path   = TCWAB_PLUGIN_DIR . 'assets/runtime-inline.js';
		$cached = file_exists($path) ? (string) file_get_contents($path) : '';
		return $cached;
	}
}
