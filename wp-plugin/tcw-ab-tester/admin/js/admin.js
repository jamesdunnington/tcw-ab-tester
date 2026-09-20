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
        .fail(function (xhr) {
          // The server answers 4xx/5xx with {success:false,data:{message}}; show that message, not a bare "failed".
          var msg = xhr && xhr.responseJSON && xhr.responseJSON.data && xhr.responseJSON.data.message;
          $result
            .text("Failed: " + (msg || "request error (HTTP " + (xhr ? xhr.status : "?") + ")"))
            .css("color", "red");
        })
        .always(function () {
          $btn.prop("disabled", false);
        });
    });
  });
})(jQuery);
