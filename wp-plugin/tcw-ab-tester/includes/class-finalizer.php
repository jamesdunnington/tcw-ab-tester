<?php
/**
 * The whole "test is over" operation in one place, so the hub makes a single
 * signed call and WordPress can keep the order safe:
 *   1. promote the winner into the original (if the winner is not the control)
 *   2. only if that succeeded, delete or retire every redundant copy
 *   3. purge caches, write the local archive row
 * If step 1 fails nothing is deleted.
 */

if (!defined('ABSPATH')) {
	exit;
}

class TCWAB_Finalizer {

	private TCWAB_Promoter $promoter;
	private TCWAB_Cleanup $cleanup;
	private TCWAB_Cache_Purge $cache;
	private TCWAB_Archive $archive;

	public function __construct(TCWAB_Promoter $promoter, TCWAB_Cleanup $cleanup, TCWAB_Cache_Purge $cache, TCWAB_Archive $archive) {
		$this->promoter = $promoter;
		$this->cleanup  = $cleanup;
		$this->cache    = $cache;
		$this->archive  = $archive;
	}

	/**
	 * @param array<string, mixed> $p
	 * @return array<string, mixed>|WP_Error
	 */
	public function finalize(array $p) {
		$source_id  = (int) ($p['sourcePostId'] ?? 0);
		$chosen_key = (string) ($p['chosenKey'] ?? '');
		$delete     = !empty($p['deleteRedundant']);
		$variants   = is_array($p['variants'] ?? null) ? $p['variants'] : [];

		if (!$source_id || '' === $chosen_key || empty($variants) || !get_post($source_id)) {
			return new WP_Error('tcwab_bad_request', 'sourcePostId, chosenKey and variants are required.', ['status' => 400]);
		}

		$manifest = ['promoted' => false, 'revisionSaved' => false, 'deleted' => [], 'retired' => [], 'errors' => []];

		foreach ($variants as $v) {
			if (($v['key'] ?? '') === $chosen_key && empty($v['isControl']) && !empty($v['postId'])) {
				$result = $this->promoter->promote($source_id, (int) $v['postId']);
				if (is_wp_error($result)) {
					return $result; // nothing has been deleted yet
				}
				$manifest['promoted']      = true;
				$manifest['revisionSaved'] = $result['revisionSaved'];
			}
		}

		$purge_ids = [$source_id];
		foreach ($variants as $v) {
			$post_id = (int) ($v['postId'] ?? 0);
			if (!empty($v['isControl']) || !$post_id) {
				continue;
			}
			if ($delete) {
				$result = $this->cleanup->delete_variant($post_id);
				if (is_wp_error($result)) {
					$manifest['errors'][] = ['postId' => $post_id, 'error' => $result->get_error_message()];
				} else {
					$manifest['deleted'][] = $result;
				}
			} elseif ($this->promoter->retire($post_id)) {
				$manifest['retired'][] = $post_id;
			}
			$purge_ids[] = $post_id;
		}

		$this->cache->purge_posts($purge_ids);

		$this->archive->record_result([
			'hub_test_id'       => sanitize_text_field((string) ($p['testId'] ?? '')),
			'test_name'         => sanitize_text_field((string) ($p['testName'] ?? '')),
			'wp_post_id'        => $source_id,
			'winner_key'        => sanitize_text_field($chosen_key),
			'redundant_deleted' => $delete && empty($manifest['errors']) ? 1 : 0,
			'started_at'        => $this->to_mysql_date($p['startedAt'] ?? null),
			'decided_at'        => current_time('mysql'),
		]);

		return $manifest;
	}

	private function to_mysql_date($iso): ?string {
		$ts = is_string($iso) ? strtotime($iso) : false;
		return $ts ? gmdate('Y-m-d H:i:s', $ts) : null;
	}
}
