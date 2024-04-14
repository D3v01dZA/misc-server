package net.caltona.miscserver;

import lombok.AllArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.dom4j.Document;
import org.dom4j.DocumentException;
import org.dom4j.Element;
import org.dom4j.io.SAXReader;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestTemplate;

import java.net.MalformedURLException;
import java.net.URL;
import java.util.*;
import java.util.stream.Collectors;

@Slf4j
@RestController
@AllArgsConstructor
public class RSSController {

    @Autowired
    private RestTemplate restTemplate;

    public enum Filter {
        SHORTS
    }

    @GetMapping(value = "/rss", produces = "text/xml; charset=UTF-8")
    public String rss(@RequestParam String url, @RequestParam String filter) throws DocumentException, MalformedURLException {
        Set<Filter> filters = parseFilters(filter);
        SAXReader saxReader = new SAXReader();
        Document root = saxReader.read(new URL(url));
        Element rootElement = root.getRootElement();
        for (Element elementToDelete : findElementsToDelete(url, filters, rootElement)) {
            rootElement.remove(elementToDelete);
        }
        return root.asXML();
    }

    private Set<Filter> parseFilters(String filter) {
        if (filter == null) {
            return Set.of();
        } else {
            return Arrays.stream(filter.split(","))
                    .map(Filter::valueOf)
                    .collect(Collectors.toSet());
        }
    }

    private List<Element> findElementsToDelete(String url, Set<Filter> filters, Element rootElement) {
        List<Element> elementsToDelete = new ArrayList<>();
        for (Element childElement : rootElement.elements()) {
            if (filters.contains(Filter.SHORTS) && "entry".equals(childElement.getName())) {
                Element id = childElement.element("id");
                if (id != null) {
                    String videoId = id.getText();
                    if (videoId != null) {
                        String[] split = videoId.split(":");
                        if (split.length == 3) {
                            String actualId = split[2];
                            log.debug("RSS URL [{}] found actual video id [{}]", url, actualId);
                            if (isShort(actualId)) {
                                elementsToDelete.add(childElement);
                                log.info("RSS URL [{}] found short [{}]", url, actualId);
                            } else {
                                log.info("RSS URL [{}] found video [{}]", url, actualId);
                            }
                        } else {
                            log.warn("RSS URL [{}] entry has a malformed id in [{}]", url, id.asXML());
                        }
                    } else {
                        log.warn("RSS URL [{}] entry has no video id in [{}]", url, id.asXML());
                    }
                } else {
                    log.warn("RSS URL [{}] entry has no id in [{}]", url, childElement.asXML());
                }
            }
        }
        return elementsToDelete;
    }

    private boolean isShort(String videoId) {
        HttpHeaders headers = restTemplate.headForHeaders("https://www.youtube.com/shorts/" + videoId);
        return !headers.containsKey("location");
    }

}
