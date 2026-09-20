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
		// The visual editor must see the original page, never a variant.
		if (TCWAB_Editor_Bridge::is_editor_request() || !is_singular() || !$this->hub_client->is_configured()) {
			return;
		}

		$post_id      = get_queried_object_id();
		// Staff are not visitors: their views and clicks would pollute the numbers, and they should always see the real page.
		// Decided winners (rules) still apply to them, so what they see matches what visitors see.
		$active_tests = self::is_excluded_visitor() ? [] : $this->tests_for_post($post_id);
		$rules        = self::rules_for_post($post_id);
		if (empty($active_tests) && empty($rules)) {
			return;
		}

		$config = [
			'ingestUrl' => $this->hub_client->get_hub_url() . '/ingest',
			'siteKey'   => $this->hub_client->get_site_key(),
			'consent'   => $this->default_consent(),
			'strict'    => $this->strict_consent(),
			'tests'     => $active_tests,
			'rules'     => $rules,
		];

		echo "<script>window.__TCWAB_CONFIG__=" . wp_json_encode($config) . ";</script>\n";

		$runtime_js = $this->get_runtime_inline_js();
		if ($runtime_js) {
			echo "<script>" . $runtime_js . "</script>\n"; // phpcs:ignore WordPress.Security.EscapeOutput -- pre-built, non-user-controlled bundle
		}

		if (!empty($active_tests)) {
			wp_enqueue_script('tcwab-tracker', TCWAB_PLUGIN_URL . 'assets/tracker.js', [], TCWAB_VERSION, true);
		}
	}

	/**
	 * Editors and admins are kept out of every test (docs/PLAN.md section 3): no assignment, no tracking.
	 * Logged-in users are normally not served the page cache, so a check at render time is safe. The
	 * "Include logged-in staff" setting (option tcwab_include_staff) or the tcwab_exclude_visitor filter
	 * turns this off, e.g. for QA of a test on the live site.
	 */
	public static function is_excluded_visitor(): bool {
		$excluded = !get_option('tcwab_include_staff', false) && is_user_logged_in() && current_user_can('edit_others_posts');
		return (bool) apply_filters('tcwab_exclude_visitor', $excluded);
	}

	/**
	 * Winning element-test changes served to everyone, with no assignment and no tracking.
	 *
	 * @return array<int, array<int, array<string, mixed>>> one ops list per decided test
	 */
	public static function rules_for_post(int $post_id): array {
		$rules = get_option('tcwab_permanent_rules', []);
		if (!is_array($rules)) {
			return [];
		}
		$out = [];
		foreach ($rules as $rule) {
			if (is_array($rule) && (int) ($rule['postId'] ?? 0) === $post_id && is_array($rule['ops'] ?? null) && !empty($rule['ops'])) {
				$out[] = array_values($rule['ops']);
			}
		}
		return $out;
	}

	/**
	 * @return array<int, array{testId:string, variants:array<int, array{key:string,weight:int,isControl:bool,redirectUrl?:string}>}>
	 */
	private function tests_for_post(int $post_id): array {
		$config = get_option('tcwab_runtime_config', []);
		if (!is_array($config)) {
			return [];
		}

		// A page-test variant is its own post. It must carry the same config as the original: the runtime
		// skips the redirect when it is already on the variant's URL, and the tracker needs the test and
		// variant to attribute this visit. Without it, visitors sent to the variant are never recorded.
		$source_id = tcwab()->variants->get_source_post_id($post_id);

		$matching = [];
		foreach ($config as $test) {
			if (!is_array($test)) {
				continue;
			}
			$tested_post = (int) ($test['wpPostId'] ?? 0);
			if ($tested_post !== $post_id && (null === $source_id || $tested_post !== $source_id)) {
				continue;
			}
			if (!in_array($test['status'] ?? '', ['running', 'winner_found', 'inconclusive'], true)) { // still splitting until the owner decides
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
	 * What to assume when no consent tool has answered. This is the ONLY consent value decided on the
	 * server, and it is the same for every visitor, so it is safe inside a cached page. The real answer
	 * is read in the visitor's browser (packages/tracker/src/consent.ts): WP Consent API, Complianz and
	 * CookieYes. Defaults to "no consent" (functional-only assignment, no tracking events) per docs/PLAN.md
	 * section 3; a site with no consent tool at all can opt in with the tcwab_default_consent filter.
	 */
	private function default_consent(): bool {
		return (bool) apply_filters('tcwab_default_consent', false);
	}

	/** Strict mode: everyone sees the original, unassigned and untracked, until statistics consent is given. */
	private function strict_consent(): bool {
		return (bool) apply_filters('tcwab_strict_consent', (bool) get_option('tcwab_strict_consent', false));
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
