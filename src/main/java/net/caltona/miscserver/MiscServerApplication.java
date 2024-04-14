package net.caltona.miscserver;

import lombok.AllArgsConstructor;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.web.client.RestTemplateBuilder;
import org.springframework.context.annotation.Bean;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.filter.CommonsRequestLoggingFilter;

import java.io.IOException;
import java.net.HttpURLConnection;

@AllArgsConstructor
@SpringBootApplication
public class MiscServerApplication {

	public static void main(String[] args) {
		SpringApplication.run(MiscServerApplication.class, args);
	}

	@Bean
	public CommonsRequestLoggingFilter loggingFilter() {
		CommonsRequestLoggingFilter filter = new CommonsRequestLoggingFilter();
		filter.setIncludeQueryString(true);
		return filter;
	}

	@Bean
	public RestTemplate restTemplate(RestTemplateBuilder restTemplateBuilder) {
		return restTemplateBuilder
				.requestFactory(RequestFactory::new)
				.build();
	}

	public class RequestFactory extends SimpleClientHttpRequestFactory {

		@Override
		protected void prepareConnection(HttpURLConnection connection, String httpMethod) throws IOException {
			super.prepareConnection(connection, httpMethod);
			connection.setInstanceFollowRedirects(false);
		}

	}

}
