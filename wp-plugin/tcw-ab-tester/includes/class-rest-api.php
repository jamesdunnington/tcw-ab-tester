<?php
/**
 * REST routes the hub calls INTO WordPress (namespace tcwab/v1). Every
 * route is signature-gated by verify_signature() — see class-hub-client.php
 * verify_request() for the HMAC check itself.
 */

if (!defined('ABSPATH')) {
	exit;
}

class TCWAB_REST_API {

	private TCWAB_Hub_Client $hub_client;
	private TCWAB_Variants $variants;
	private TCWAB_Finalizer $finalizer;
	private TCWAB_Cache_Purge $cache;

	public function __construct(TCWAB_Hub_Client $hub_client, TCWAB_Variants $variants, TCWAB_Finalizer $finalizer, TCWAB_Cache_Purge $cache) {
		$this->hub_client = $hub_client;
		$this->variants   = $variants;
		$this->finalizer  = $finalizer;
		$this->cache      = $cache;
	}

	public function register_routes(): void {
		add_action('rest_api_init', function () {
			register_rest_route('tcwab/v1', '/posts/(?P<id>\d+)', [
				'methods'             => 'GET',
				'callback'            => [$this, 'get_post_info'],
				'permission_callback' => [$this, 'verify_signature'],
			]);
			register_rest_route('tcwab/v1', '/posts/(?P<id>\d+)/snapshot', [
				'methods'             => 'GET',
				'callback'            => [$this, 'get_post_snapshot'],
				'permission_callback' => [$this, 'verify_signature'],
			]);
			register_rest_route('tcwab/v1', '/library/draft', [
				'methods'             => 'POST',
				'callback'            => [$this, 'create_library_draft'],
				'permission_callback' => [$this, 'verify_signature'],
			]);
			register_rest_route('tcwab/v1', '/rules', [
				'methods'             => 'POST',
				'callback'            => [$this, 'store_rule'],
				'permission_callback' => [$this, 'verify_signature'],
			]);
			register_rest_route('tcwab/v1', '/rules/(?P<id>[A-Za-z0-9_-]+)', [
				'methods'             => 'DELETE',
				'callback'            => [$this, 'delete_rule'],
				'permission_callback' => [$this, 'verify_signature'],
			]);
			register_rest_route('tcwab/v1', '/posts', [
				'methods'             => 'GET',
				'callback'            => [$this, 'search_posts'],
				'permission_callback' => [$this, 'verify_signature'],
			]);
			register_rest_route('tcwab/v1', '/variants', [
				'methods'             => 'POST',
				'callback'            => [$this, 'create_variant'],
				'permission_callback' => [$this, 'verify_signature'],
			]);
			register_rest_route('tcwab/v1', '/config', [
				'methods'             => 'POST',
				'callback'            => [$this, 'store_config'],
				'permission_callback' => [$this, 'verify_signature'],
			]);
			register_rest_route('tcwab/v1', '/posts/(?P<id>\d+)/restore', [
				'methods'             => 'POST',
				'callback'            => [$this, 'restore_original'],
				'permission_callback' => [$this, 'verify_signature'],
			]);
			register_rest_route('tcwab/v1', '/finalize', [
				'methods'             => 'POST',
				'callback'            => [$this, 'finalize'],
				'permission_callback' => [$this, 'verify_signature'],
			]);
		});
	}

	public function verify_signature(WP_REST_Request $request): bool {
		$site_key  = $request->get_header('x-tcw-site-key');
		$timestamp = $request->get_header('x-tcw-timestamp');
		$nonce     = $request->get_header('x-tcw-nonce');
		$signature = $request->get_header('x-tcw-signature');

		if (!$site_key || !$timestamp || !$nonce || !$signature) {
			return false;
		}
		if (!hash_equals($this->hub_client->get_site_key(), $site_key)) {
			return false;
		}

		// get_route() returns "/tcwab/v1/..." — this must match exactly the path
		// hub/apps/api/src/lib/wp-client.ts signed (it signs the path portion of
		// "/wp-json/tcwab/v1/..."), so rebuild it the same way.
		$path = '/wp-json' . $request->get_route();
		$body = $request->get_body();

		return $this->hub_client->verify_request($request->get_method(), $path, $body, $timestamp, $nonce, $signature);
	}

	public function get_post_info(WP_REST_Request $request) {
		$result = $this->variants->get_post_info((int) $request->get_param('id'));
		if (is_wp_error($result)) {
			return $result;
		}
		return new WP_REST_Response($result, 200);
	}

	public function get_post_snapshot(WP_REST_Request $request) {
		$result = $this->variants->get_post_snapshot((int) $request->get_param('id'));
		if (is_wp_error($result)) {
			return $result;
		}
		return new WP_REST_Response($result, 200);
	}

	public function create_library_draft(WP_REST_Request $request) {
		$params = (array) $request->get_json_params();
		if ('' === trim((string) ($params['title'] ?? '')) && '' === trim((string) ($params['content'] ?? ''))) {
			return new WP_Error('tcwab_bad_request', 'A title or content is required.', ['status' => 400]);
		}
		$result = $this->variants->create_library_draft($params);
		if (is_wp_error($result)) {
			return $result;
		}
		return new WP_REST_Response($result, 201);
	}

	public function store_rule(WP_REST_Request $request) {
		$params = (array) $request->get_json_params();
		$result = $this->finalizer->apply_rule(sanitize_text_field((string) ($params['ruleId'] ?? '')), (int) ($params['postId'] ?? 0), $params['ops'] ?? null);
		if (is_wp_error($result)) {
			return $result;
		}
		return new WP_REST_Response($result, 200);
	}

	public function search_posts(WP_REST_Request $request) {
		$search = sanitize_text_field((string) $request->get_param('search'));
		$limit  = (int) $request->get_param('limit');
		return new WP_REST_Response(['posts' => $this->variants->search_posts($search, $limit > 0 ? $limit : 10)], 200);
	}

	public function create_variant(WP_REST_Request $request) {
		$params      = $request->get_json_params();
		$test_id     = sanitize_text_field($params['testId'] ?? '');
		$variant_key = sanitize_text_field($params['variantKey'] ?? '');
		$source_id   = (int) ($params['sourcePostId'] ?? 0);
		$label       = sanitize_text_field($params['label'] ?? 'Variant');

		if (!$test_id || !$variant_key || !$source_id) {
			return new WP_Error('tcwab_bad_request', 'Missing testId, variantKey, or sourcePostId.', ['status' => 400]);
		}

		$result = $this->variants->duplicate_post($source_id, $test_id, $variant_key, $label);
		if (is_wp_error($result)) {
			return $result;
		}
		return new WP_REST_Response($result, 201);
	}

	public function store_config(WP_REST_Request $request) {
		$params = $request->get_json_params();
		$tests  = is_array($params['tests'] ?? null) ? $params['tests'] : [];

		// Cached pages embed the config, so purge every post whose test set changed
		// (posts in the old config AND the new one) once the new config is saved.
		$previous = get_option('tcwab_runtime_config', []);
		update_option('tcwab_runtime_config', $tests, false);

		$affected = array_merge(
			array_column(is_array($previous) ? $previous : [], 'wpPostId'),
			array_column($tests, 'wpPostId')
		);
		$this->cache->purge_posts($affected);

		return new WP_REST_Response(['ok' => true, 'testCount' => count($tests)], 200);
	}

	public function delete_rule(WP_REST_Request $request) {
		return new WP_REST_Response($this->finalizer->remove_rule((string) $request->get_param('id')), 200);
	}

	public function restore_original(WP_REST_Request $request) {
		$result = $this->finalizer->restore_original((int) $request->get_param('id'), (array) $request->get_json_params());
		if (is_wp_error($result)) {
			return $result;
		}
		return new WP_REST_Response($result, 200);
	}

	public function finalize(WP_REST_Request $request) {
		$result = $this->finalizer->finalize((array) $request->get_json_params());
		if (is_wp_error($result)) {
			return $result;
		}
		return new WP_REST_Response($result, 200);
	}
}
