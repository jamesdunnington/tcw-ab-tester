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

		$permanent = $this->store_permanent_rule($source_id, (string) ($p['testId'] ?? ''), $p['permanentOps'] ?? null);
		if ($permanent) {
			$manifest['permanentRule'] = true;
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

		if (!empty($p['discard'])) {
			return $manifest; // a draft that never ran: no archive row
		}

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

	/**
	 * Restore an original after a winner replaced it, from the copy the hub kept.
	 *
	 * @param array<string, mixed> $snapshot
	 * @return array{restored:true, revisionSaved:bool}|WP_Error
	 */
	public function restore_original(int $post_id, array $snapshot) {
		$result = $this->promoter->restore_original($post_id, $snapshot);
		if (!is_wp_error($result)) {
			$this->cache->purge_posts([$post_id]);
		}
		return $result;
	}

	/**
	 * Library reuse: a change set that goes live at once as a permanent rule on one post, with no test.
	 * Same storage and validation as an element-test winner.
	 *
	 * @param mixed $ops
	 * @return array{ok:bool}|WP_Error
	 */
	public function apply_rule(string $rule_id, int $post_id, $ops) {
		if ('' === $rule_id || !$post_id || !get_post($post_id)) {
			return new WP_Error('tcwab_bad_request', 'ruleId and an existing postId are required.', ['status' => 400]);
		}
		if (!$this->store_permanent_rule($post_id, $rule_id, $ops)) {
			return new WP_Error('tcwab_bad_request', 'No valid changes to apply.', ['status' => 400]);
		}
		$this->cache->purge_posts([$post_id]);
		return ['ok' => true];
	}

	/**
	 * Undo an element test's winner: drop its permanent rule so the page serves its own content again.
	 *
	 * @return array{ok:bool, removed:bool}
	 */
	public function remove_rule(string $rule_id): array {
		$rules = get_option('tcwab_permanent_rules', []);
		$rules = is_array($rules) ? $rules : [];
		$key   = sanitize_text_field($rule_id);
		if (!isset($rules[$key])) {
			return ['ok' => true, 'removed' => false];
		}
		$post_id = (int) ($rules[$key]['postId'] ?? 0);
		unset($rules[$key]);
		update_option('tcwab_permanent_rules', $rules, false);
		if ($post_id) {
			$this->cache->purge_posts([$post_id]);
		}
		return ['ok' => true, 'removed' => true];
	}

	/**
	 * Element tests: keep the winning change set as a permanent rule, served to everyone by the
	 * inline runtime. The hub has already validated the ops; this only drops malformed entries.
	 *
	 * @param mixed $ops
	 */
	private function store_permanent_rule(int $post_id, string $test_id, $ops): bool {
		if ('' === $test_id || !is_array($ops)) {
			return false;
		}
		$clean = [];
		foreach ($ops as $op) {
			if (is_array($op) && is_string($op['op'] ?? null) && is_string($op['selector'] ?? null) && 'goal' !== $op['op']) {
				$clean[] = $op;
			}
		}
		if (empty($clean)) {
			return false;
		}
		$rules = get_option('tcwab_permanent_rules', []);
		$rules = is_array($rules) ? $rules : [];
		$rules[sanitize_text_field($test_id)] = ['postId' => $post_id, 'ops' => $clean];
		update_option('tcwab_permanent_rules', $rules, false);
		return true;
	}

	private function to_mysql_date($iso): ?string {
		$ts = is_string($iso) ? strtotime($iso) : false;
		return $ts ? gmdate('Y-m-d H:i:s', $ts) : null;
	}
}
