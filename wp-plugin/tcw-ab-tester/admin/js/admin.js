(function ($) {
  "use strict";

  $(function () {
    $("#tcwab-test-connection").on("click", function () {
      var $btn = $(this);
      var $result = $("#tcwab-test-connection-result");
      $btn.prop("disabled", true);
      $result.text("Testing…").css("color", "");

      $.post(TCWAB_ADMIN.ajaxUrl, {
        action: "tcwab_test_connection",
        nonce: TCWAB_ADMIN.nonce,
      })
        .done(function (response) {
          if (response && response.success) {
            var text = "Connected: " + (response.data.displayName || "OK");
            if (response.data.warning) {
              $result.text(text + ". Warning: " + response.data.warning).css("color", "#b45309");
            } else {
              $result.text(text).css("color", "green");
            }
          } else {
            $result.text("Failed: " + (response.data && response.data.message ? response.data.message : "unknown error")).css("color", "red");
          }
        })
        .fail(function () {
          $result.text("Request failed.").css("color", "red");
        })
        .always(function () {
          $btn.prop("disabled", false);
        });
    });
  });
})(jQuery);
