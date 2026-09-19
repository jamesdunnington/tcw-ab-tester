<?php
/**
 * Settings storage + the signed HTTP bridge to the hub, in both
 * directions:
 *   - sign_request()/call_hub(): WordPress calling INTO the hub
 *   - verify_request(): the hub calling INTO WordPress (used by
 *     class-rest-api.php's permission_callback)
 *
 * This is the PHP mirror of packages/shared/src/hmac.ts — the exact same
 * message format and HMAC-SHA256 algorithm on both sides. If you change
 * one, change the other.
 */

if (!defined('ABSPATH')) {
	exit;
}

class TCWAB_Hub_Client {

	private const OPTION_HUB_URL     = 'tcwab_hub_url';
	private const OPTION_SITE_KEY    = 'tcwab_site_key';
	private const OPTION_SITE_SECRET = 'tcwab_site_secret';
	private const SIGNATURE_SKEW_SECONDS = 300;

	public function get_hub_url(): string {
		return rtrim((string) get_option(self::OPTION_HUB_URL, ''), '/');
	}

	public function get_site_key(): string {
		return (string) get_option(self::OPTION_SITE_KEY, '');
	}

	private function get_site_secret(): string {
		return (string) get_option(self::OPTION_SITE_SECRET, '');
	}

	public function is_configured(): bool {
		return $this->get_hub_url() !== '' && $this->get_site_key() !== '' && $this->get_site_secret() !== '';
	}

	public function save_settings(string $hub_url, string $site_key, string $site_secret): void {
		update_option(self::OPTION_HUB_URL, esc_url_raw(rtrim($hub_url, '/')), false);
		update_option(self::OPTION_SITE_KEY, sanitize_text_field($site_key), false);
		// Not autoloaded: this only needs to be read on the rare signed
		// request, not on every single page load.
		update_option(self::OPTION_SITE_SECRET, $site_secret, false);
	}

	private function build_message(string $method, string $path, string $timestamp, string $nonce, string $body): string {
		$body_hash = hash('sha256', $body);
		return implode("\n", [strtoupper($method), $path, $timestamp, $nonce, $body_hash]);
	}

	/** @return array{timestamp:string,nonce:string,signature:string} */
	private function sign_request(string $method, string $path, string $body): array {
		$timestamp = (string) time();
		$nonce     = wp_generate_password(24, false);
		$message   = $this->build_message($method, $path, $timestamp, $nonce, $body);
		$signature = hash_hmac('sha256', $message, $this->get_site_secret());
		return ['timestamp' => $timestamp, 'nonce' => $nonce, 'signature' => $signature];
	}

	/** Verifies a signature the hub attached to an inbound request to us. */
	public function verify_request(string $method, string $path, string $body, string $timestamp, string $nonce, string $signature): bool {
		if (!ctype_digit($timestamp)) {
			return false;
		}
		if (abs(time() - (int) $timestamp) > self::SIGNATURE_SKEW_SECONDS) {
			return false;
		}
		$message  = $this->build_message($method, $path, $timestamp, $nonce, $body);
		$expected = hash_hmac('sha256', $message, $this->get_site_secret());
		return hash_equals($expected, $signature);
	}

	/**
	 * Verifies a visual-editor token minted by the hub. PHP mirror of
	 * packages/shared/src/editor-token.ts (verifyEditorToken): keep in sync.
	 *
	 * @return array{sk:string,t:string,v:string,exp:int,n:string}|null Payload when valid, null otherwise.
	 */
	public function verify_editor_token(string $token): ?array {
		if (!$this->is_configured() || !preg_match('/^([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/', $token, $m)) {
			return null;
		}
		$expected = hash_hmac('sha256', "tcwab-editor\n" . $m[1], $this->get_site_secret());
		if (!hash_equals($expected, $m[2])) {
			return null;
		}
		$json    = base64_decode(strtr($m[1], '-_', '+/'), true);
		$payload = is_string($json) ? json_decode($json, true) : null;
		if (!is_array($payload) || !isset($payload['sk'], $payload['t'], $payload['v'], $payload['exp'])) {
			return null;
		}
		if ($payload['sk'] !== $this->get_site_key() || time() > (int) $payload['exp']) {
			return null;
		}
		return $payload;
	}

	/**
	 * Calls the hub. Returns the decoded JSON body on 2xx, or a WP_Error.
	 * @param array<string, mixed>|null $body
	 * @return array<string, mixed>|WP_Error
	 */
	public function call_hub(string $method, string $path, ?array $body = null) {
		if (!$this->is_configured()) {
			return new WP_Error('tcwab_not_configured', __('TCW A/B Tester is not connected to a hub yet.', 'tcw-ab-tester'));
		}

		$body_json = null === $body ? '' : wp_json_encode($body);
		$signed    = $this->sign_request($method, $path, $body_json);

		$args = [
			'method'  => $method,
			'headers' => [
				'content-type'      => 'application/json',
				'x-tcw-site-key'    => $this->get_site_key(),
				'x-tcw-timestamp'   => $signed['timestamp'],
				'x-tcw-nonce'       => $signed['nonce'],
				'x-tcw-signature'   => $signed['signature'],
			],
			'timeout' => 15,
		];
		if ('' !== $body_json) {
			$args['body'] = $body_json;
		}

		$response = wp_remote_request($this->get_hub_url() . $path, $args);
		if (is_wp_error($response)) {
			return $response;
		}

		$code = wp_remote_retrieve_response_code($response);
		$data = json_decode(wp_remote_retrieve_body($response), true);

		if ($code < 200 || $code >= 300) {
			return new WP_Error(
				'tcwab_hub_error',
				sprintf(__('Hub returned HTTP %d', 'tcw-ab-tester'), $code),
				['status' => $code, 'body' => $data]
			);
		}

		return is_array($data) ? $data : [];
	}

	/** @return array<string, mixed>|WP_Error */
	public function test_connection() {
		return $this->call_hub('POST', '/wp/v1/heartbeat', [
			'wpVersion'     => get_bloginfo('version'),
			'pluginVersion' => TCWAB_VERSION,
		]);
	}
}
