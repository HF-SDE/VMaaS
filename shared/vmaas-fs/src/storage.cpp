#include "storage.h"

#include <cstdio>
#include "esp_littlefs.h"
#include "esp_log.h"

namespace
{
    constexpr const char* TAG = "VmaasFs";
}

namespace vmaas::fs
{
    bool mount(const char* partition_label, const char* mount_point)
    {
        esp_vfs_littlefs_conf_t conf = {};
        conf.base_path = mount_point;
        conf.partition_label = partition_label;
        conf.format_if_mount_failed = false;
        conf.dont_mount = false;

        const esp_err_t err = esp_vfs_littlefs_register(&conf);
        if (err != ESP_OK)
        {
            ESP_LOGE(TAG, "mount %s failed: %s", mount_point, esp_err_to_name(err));
            return false;
        }

        size_t total = 0, used = 0;
        if (esp_littlefs_info(partition_label, &total, &used) == ESP_OK) {
            ESP_LOGI(TAG, "mounted %s: %u of %u bytes used", mount_point, static_cast<unsigned>(used), static_cast<unsigned>(total));
        }
        else {
            ESP_LOGW(TAG, "mounted %s, but usage query failed", mount_point);
        }
        return true;
    }

    int read_text_file(const char* path, char* buf, size_t capacity)
    {
        if (buf == nullptr || capacity == 0) return -2;

        FILE* f = std::fopen(path, "rb");
        if (f == nullptr) return -1;

        const size_t n = std::fread(buf, 1, capacity - 1, f);
        
        // If anything is left, the file is bigger than the buffer. Without this
        // check it would be read as a valid, silently shortened config.
        const bool more = (std::fgetc(f) != EOF);
        const bool failed_read = std::ferror(f) != 0;
        std::fclose(f);

        if (more || failed_read)
        {
            buf[0] = '\0';
            return failed_read ? -1 : -2;
        }
        buf[n] = '\0';
        return static_cast<int>(n);
    }
}
