package net.caltona.miscserver;

import lombok.extern.slf4j.Slf4j;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@Slf4j
@RestController
public class IndexController {

    public IndexController() {
    }

    @GetMapping(value = "/")
    public String index() {
        return "Root";
    }

}
